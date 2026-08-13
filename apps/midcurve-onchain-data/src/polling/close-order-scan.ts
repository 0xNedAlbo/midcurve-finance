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
import {
  createPublicClient,
  http,
  keccak256,
  toHex,
  TimeoutError,
  type PublicClient,
} from 'viem';
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

// ============================================================
// Scan Client
// ============================================================

/**
 * Milliseconds allowed for one close order sweep.
 *
 * A sweep is a single eth_getLogs call over the whole range — up to full chain
 * history when the cursor is cold — so viem's 10 second transport default is far
 * too short for it. There is no per-request override in viem: `client.request`
 * only overrides retry options, and the timeout is fixed when the transport is
 * built. Hence a dedicated client.
 *
 * retryCount is 0 on purpose. Three silent retries of a two minute request is
 * six minutes of a startup path that looks hung — indistinguishable from the
 * hang this is meant to surface.
 */
const SCAN_TIMEOUT_MS = 120_000;

const scanClients = new Map<number, PublicClient>();

/**
 * Public client used for close order sweeps only.
 *
 * Deliberately not `EvmConfig.getPublicClient()`: that instance is shared by
 * every reader in the process and carries viem's defaults. Raising the timeout
 * there would change the behaviour of unrelated calls.
 */
function getScanClient(chainId: number): PublicClient {
  const cached = scanClients.get(chainId);
  if (cached) return cached;

  const chainConfig = EvmConfig.getInstance().getChainConfig(chainId);
  const client = createPublicClient({
    chain: chainConfig.viemChain,
    transport: http(chainConfig.rpcUrl, {
      timeout: SCAN_TIMEOUT_MS,
      retryCount: 0,
    }),
  });

  scanClients.set(chainId, client);
  return client;
}

/**
 * The diagnosis that ships with a failed sweep.
 *
 * Two failures look the same in a stack trace and have opposite answers:
 *
 * - The provider rejected the range. Then the assumption baked into this file is
 *   wrong, and saying so is the whole point — nothing in the code hints that a
 *   plan and a chain set were assumed.
 * - The request timed out. The range was never rejected; the call was still
 *   running. Naming the plan here would send the reader to their Alchemy
 *   dashboard over a request that simply needed longer.
 *
 * A confidently wrong diagnosis is worse than none, so the timeout branch says
 * what happened and stops there.
 */
function describeScanFailure(options: {
  chainId: number;
  fromBlock: bigint;
  toBlock: bigint;
  error: unknown;
}): string {
  const { chainId, fromBlock, toBlock, error } = options;
  const range = `chain ${chainId} over blocks ${fromBlock}-${toBlock} in a single eth_getLogs call`;

  if (error instanceof TimeoutError) {
    return (
      `Close order scan timed out after ${SCAN_TIMEOUT_MS} ms for ${range}. ` +
      'The request was still running when the client gave up: this is not a rejected ' +
      'block range and says nothing about the RPC plan. The cursor is left where it ' +
      'was and the next poll retries the same range.'
    );
  }

  return (
    `Close order scan failed for ${range}. The range is deliberately not split into ` +
    'windows: this code assumes an Alchemy Pay As You Go key or better, on Ethereum, ' +
    'Arbitrum or Base, where eth_getLogs accepts unlimited block ranges. A free-tier ' +
    'key or a different provider is the likely cause. See issue #88.'
  );
}

// ============================================================
// The Sweep
// ============================================================

/**
 * Scan `fromBlock` → `toBlock` for close order events in ONE eth_getLogs call.
 *
 * No block-window batching: see the note on SCAN_TIMEOUT_MS and #88. A closer
 * query filtered by address and topic returns zero-to-few logs even over full
 * chain history, nowhere near the 150MB response cap.
 *
 * THIS FUNCTION THROWS. It used to catch, warn, and return whatever it had,
 * which the caller could not distinguish from "no events found" — so the caller
 * advanced the cursor over blocks nobody had looked at. Under a single sweep the
 * identical failure would lose the entire range rather than one window, silently.
 * The contract is now binary: the range was scanned, or this throws.
 */
export async function fetchHistoricalCloseOrderEvents(options: {
  chainId: number;
  contractAddresses: string[];
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<{ event: ReturnType<typeof buildCloseOrderEvent>; blockNumber: bigint }[]> {
  const { chainId, contractAddresses, fromBlock, toBlock } = options;
  const client = getScanClient(chainId);
  const results: { event: ReturnType<typeof buildCloseOrderEvent>; blockNumber: bigint }[] = [];
  const startedAt = Date.now();

  let rpcLogs: unknown[];
  try {
    rpcLogs = (await client.request({
      method: 'eth_getLogs',
      params: [{
        address: contractAddresses as `0x${string}`[],
        topics: [LIFECYCLE_EVENT_SIGNATURES as `0x${string}`[]],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      }],
    })) as unknown[];
  } catch (error) {
    // Re-throw, not swallow: the message carries the diagnosis, `cause` carries
    // the provider's own error.
    throw new Error(describeScanFailure({ chainId, fromBlock, toBlock, error }), {
      cause: error,
    });
  }

  for (const rpcLog of rpcLogs) {
    const logData = rpcLog as {
      address: string;
      topics: `0x${string}`[];
      data: `0x${string}`;
      blockNumber: string;
      transactionHash: `0x${string}`;
      logIndex: string;
      removed?: boolean;
    };

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

  // Sort by blockNumber, then logIndex. One response cannot hold the same log
  // twice, so the dedupe set the windowed version needed is gone; the sort
  // stays, because "published in chain order" should be a property of this
  // function rather than an accident of the provider's response order.
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
    blocksScanned: (toBlock - fromBlock + 1n).toString(),
    eventsFound: results.length,
    durationMs: Date.now() - startedAt,
  }, 'Scanned close order events');

  return results;
}

