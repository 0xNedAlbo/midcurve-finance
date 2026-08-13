/**
 * Close Order Event Scan
 *
 * Scans closer contracts for close order lifecycle events via eth_getLogs, and
 * owns the per-chain cursor those scans resume from.
 *
 * THERE IS NO STARTUP CATCH-UP. It existed as a separate mechanism because the
 * first poll faced the same block-window penalty as a backfill did. With the
 * window gone, the first poll IS the catch-up:
 * `UniswapV3CloserPollingBatch.poll()` scans `lastProcessedBlock + 1` →
 * `client.getBlockNumber()`, and `start()` fires it immediately rather than
 * waiting out an interval. See #88.
 *
 * Filtering is by contract address (not nftId topic), and logs are decoded with
 * the V100 ABIs.
 */

import { EvmConfig, CacheService } from '@midcurve/services';
import {
  UniswapV3PositionCloserV100Abi,
  UniswapV3VaultPositionCloserV100Abi,
} from '@midcurve/shared';
import { keccak256, toHex } from 'viem';
import { onchainDataLogger } from '../lib/logger';
import {
  buildCloseOrderEvent,
  type RawEventLog,
} from '../mq/close-order-messages';

const log = onchainDataLogger.child({ component: 'CloseOrderScan' });

// ============================================================
// Block Tracker (separate cache keys from position-liquidity)
// ============================================================

const CLOSE_ORDER_BLOCK_CACHE_PREFIX = 'onchain-data:close-order-subscriber:last-block';
const BLOCK_TRACKING_TTL_SECONDS = 31536000; // 1 year

function buildBlockCacheKey(chainId: number): string {
  return `${CLOSE_ORDER_BLOCK_CACHE_PREFIX}:${chainId}`;
}

export async function getCloseOrderLastProcessedBlock(chainId: number): Promise<bigint | null> {
  const cache = CacheService.getInstance();
  const key = buildBlockCacheKey(chainId);

  try {
    const record = await cache.get<{ blockNumber: string }>(key);
    if (!record) return null;
    return BigInt(record.blockNumber);
  } catch (error) {
    log.warn(
      { chainId, error: error instanceof Error ? error.message : String(error) },
      'Failed to get cached close order block'
    );
    return null;
  }
}

export async function setCloseOrderLastProcessedBlock(chainId: number, blockNumber: bigint): Promise<void> {
  const cache = CacheService.getInstance();
  const key = buildBlockCacheKey(chainId);

  try {
    await cache.set(key, { blockNumber: blockNumber.toString(), updatedAt: new Date().toISOString() }, BLOCK_TRACKING_TTL_SECONDS);
    log.debug({ chainId, blockNumber: blockNumber.toString() }, 'Updated cached close order block');
  } catch (error) {
    log.warn(
      { chainId, blockNumber: blockNumber.toString(), error: error instanceof Error ? error.message : String(error) },
      'Error updating cached close order block'
    );
  }
}

export async function updateCloseOrderBlockIfHigher(chainId: number, blockNumber: bigint): Promise<void> {
  const cached = await getCloseOrderLastProcessedBlock(chainId);
  if (cached === null || blockNumber > cached) {
    await setCloseOrderLastProcessedBlock(chainId, blockNumber);
  }
}

// ============================================================
// Historical Event Fetching (address-based, not topic-based)
// ============================================================

/**
 * Lifecycle events the fallback path replays.
 *
 * OrderExecuted is included: half a safety net is worse than a known-missing
 * one. OrderSharesUpdated is vault-only and simply absent from the NFT ABI.
 */
const LIFECYCLE_EVENT_NAMES = new Set([
  'OrderRegistered',
  'OrderCancelled',
  'OrderExecuted',
  'OrderOperatorUpdated',
  'OrderPayoutUpdated',
  'OrderTriggerTickUpdated',
  'OrderValidUntilUpdated',
  'OrderSlippageUpdated',
  'OrderSwapIntentUpdated',
  'OrderSharesUpdated',
]);

/**
 * Compute event signatures from the ABIs.
 * viem's decodeEventLog handles this internally, but for eth_getLogs
 * topics[0] filtering we need the keccak256 hashes.
 *
 * Both closer ABIs are covered: the vault events carry different parameter
 * types, so their topic0 differs and an NFT-only filter excludes every vault
 * event even when the vault closer address is being polled.
 */
function computeEventSignatures(): `0x${string}`[] {
  const signatures = new Set<`0x${string}`>();

  const abis = [
    UniswapV3PositionCloserV100Abi,
    UniswapV3VaultPositionCloserV100Abi,
  ] as const;

  for (const abi of abis) {
    for (const item of abi) {
      if (item.type !== 'event') continue;
      if (!LIFECYCLE_EVENT_NAMES.has(item.name)) continue;

      // Build canonical event signature string: EventName(type1,type2,...)
      const params = item.inputs.map((input: { type: string }) => input.type).join(',');
      const sig = `${item.name}(${params})`;
      signatures.add(keccak256(toHex(sig)));
    }
  }

  return Array.from(signatures);
}

const LIFECYCLE_EVENT_SIGNATURES = computeEventSignatures();

/**
 * Fetch historical close order events using eth_getLogs.
 *
 * Filters by contract addresses and event signatures.
 * Processes in batches to respect RPC limits.
 */
export async function fetchHistoricalCloseOrderEvents(options: {
  chainId: number;
  contractAddresses: string[];
  fromBlock: bigint;
  toBlock: bigint;
  batchSize: number;
}): Promise<{ event: ReturnType<typeof buildCloseOrderEvent>; blockNumber: bigint }[]> {
  const { chainId, contractAddresses, fromBlock, toBlock, batchSize } = options;
  const evmConfig = EvmConfig.getInstance();
  const client = evmConfig.getPublicClient(chainId);
  const results: { event: ReturnType<typeof buildCloseOrderEvent>; blockNumber: bigint }[] = [];

  // Dedup set: txHash:logIndex
  const seen = new Set<string>();

  // Process in batches
  for (let start = fromBlock; start <= toBlock; start += BigInt(batchSize)) {
    const end = start + BigInt(batchSize) - 1n > toBlock ? toBlock : start + BigInt(batchSize) - 1n;

    try {
      const rpcLogs = await client.request({
        method: 'eth_getLogs',
        params: [{
          address: contractAddresses as `0x${string}`[],
          topics: [LIFECYCLE_EVENT_SIGNATURES as `0x${string}`[]],
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
        }],
      });

      for (const rpcLog of rpcLogs as unknown[]) {
        const logData = rpcLog as {
          address: string;
          topics: `0x${string}`[];
          data: `0x${string}`;
          blockNumber: string;
          transactionHash: `0x${string}`;
          logIndex: string;
          removed?: boolean;
        };

        // Dedup
        const dedupeKey = `${logData.transactionHash}:${logData.logIndex}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const rawLog: RawEventLog = {
          address: logData.address,
          topics: logData.topics as [`0x${string}`, ...`0x${string}`[]],
          data: logData.data,
          blockNumber: BigInt(logData.blockNumber),
          transactionHash: logData.transactionHash,
          logIndex: Number(logData.logIndex),
          removed: logData.removed,
        };

        const domainEvent = buildCloseOrderEvent(chainId, logData.address.toLowerCase(), rawLog);
        if (domainEvent) {
          results.push({ event: domainEvent, blockNumber: rawLog.blockNumber });
        }
      }
    } catch (error) {
      log.warn({
        chainId,
        fromBlock: start.toString(),
        toBlock: end.toString(),
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to fetch historical close order events for batch');
    }
  }

  // Sort by blockNumber, then logIndex
  results.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    return (a.event?.logIndex ?? 0) - (b.event?.logIndex ?? 0);
  });

  log.info({
    chainId,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    eventsFound: results.length,
  }, 'Fetched historical close order events');

  return results;
}

