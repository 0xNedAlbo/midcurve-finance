/**
 * Close Order Catch-Up Orchestrator
 *
 * Coordinates the catch-up process for close order lifecycle events:
 *
 * 1. NON-FINALIZED BLOCKS (Phase 1 - blocking):
 *    Scans from (finalizedBlock + 1) to currentBlock.
 *    Must complete before subscriber starts normal operation.
 *    These blocks could reorg, so we process them first while subscriber buffers.
 *
 * 2. FINALIZED BLOCKS (Phase 2 - background):
 *    Scans from cachedBlock to finalizedBlock.
 *    Safe to run in background since these blocks are immutable.
 *
 * Unlike position-liquidity catch-up, this uses contract addresses (not nftId topics)
 * for eth_getLogs filtering, and decodes logs using the V100 ABI.
 */

import { EvmConfig, EvmBlockService, CacheService } from '@midcurve/services';
import { UniswapV3PositionCloserV100Abi } from '@midcurve/shared';
import { keccak256, toHex } from 'viem';
import { onchainDataLogger } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { buildCloseOrderRoutingKey } from '../mq/topology';
import {
  buildCloseOrderEvent,
  serializeCloseOrderEvent,
  type RawEventLog,
} from '../mq/close-order-messages';
import { getCatchUpConfig } from '../lib/config';

const log = onchainDataLogger.child({ component: 'CloseOrderCatchUp' });

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
// Catch-Up Result
// ============================================================

export interface CatchUpResult {
  chainId: number;
  eventsPublished: number;
  fromBlock: bigint;
  toBlock: bigint;
  durationMs: number;
  error?: string;
}

// ============================================================
// Safety Margins
// ============================================================

const FINALITY_SAFETY_MARGINS: Record<number, bigint> = {
  1: 64n,
  42161: 64n,
  8453: 64n,
  56: 64n,
  137: 128n,
  10: 64n,
};

async function getFinalizedBlockNumber(chainId: number): Promise<bigint> {
  const evmBlockService = new EvmBlockService();
  const evmConfig = EvmConfig.getInstance();

  let finalizedBlock = await evmBlockService.getLastFinalizedBlockNumber(chainId);

  if (finalizedBlock === null) {
    const client = evmConfig.getPublicClient(chainId);
    const currentBlock = await client.getBlockNumber();
    const safetyMargin = FINALITY_SAFETY_MARGINS[chainId] ?? 64n;
    finalizedBlock = currentBlock - safetyMargin;

    log.warn({
      chainId,
      currentBlock: currentBlock.toString(),
      safetyMargin: safetyMargin.toString(),
      pseudoFinalizedBlock: finalizedBlock.toString(),
    }, 'Finalized block unavailable, using safety margin fallback');
  }

  return finalizedBlock;
}

// ============================================================
// Historical Event Fetching (address-based, not topic-based)
// ============================================================

/**
 * Compute keccak256 event signatures for the 8 lifecycle events.
 * We extract them by decoding the ABI entry names at import time.
 */
const LIFECYCLE_EVENT_NAMES = new Set([
  'OrderRegistered',
  'OrderCancelled',
  'OrderOperatorUpdated',
  'OrderPayoutUpdated',
  'OrderTriggerTickUpdated',
  'OrderValidUntilUpdated',
  'OrderSlippageUpdated',
  'OrderSwapIntentUpdated',
]);

/**
 * Compute event signatures from the ABI.
 * viem's decodeEventLog handles this internally, but for eth_getLogs
 * topics[0] filtering we need the keccak256 hashes.
 */
function computeEventSignatures(): `0x${string}`[] {
  const signatures: `0x${string}`[] = [];

  for (const item of UniswapV3PositionCloserV100Abi) {
    if (item.type !== 'event') continue;
    if (!LIFECYCLE_EVENT_NAMES.has(item.name)) continue;

    // Build canonical event signature string: EventName(type1,type2,...)
    const params = item.inputs.map((input: { type: string }) => input.type).join(',');
    const sig = `${item.name}(${params})`;
    signatures.push(keccak256(toHex(sig)));
  }

  return signatures;
}

const LIFECYCLE_EVENT_SIGNATURES = computeEventSignatures();

/**
 * Fetch historical close order events using eth_getLogs.
 *
 * Filters by contract addresses and event signatures.
 * Processes in batches to respect RPC limits.
 */
async function fetchHistoricalCloseOrderEvents(options: {
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

// ============================================================
// Catch-Up Orchestrators
// ============================================================

/**
 * Execute catch-up for NON-FINALIZED blocks.
 * Scans from (finalizedBlock + 1) to currentBlock.
 * Must run while subscriber is buffering.
 */
export async function executeCloseOrderCatchUpNonFinalized(
  chainId: number,
  contractAddresses: string[]
): Promise<CatchUpResult> {
  const startTime = Date.now();
  const config = getCatchUpConfig();

  log.info({ chainId, contractCount: contractAddresses.length }, 'Starting non-finalized close order catch-up');

  try {
    const finalizedBlock = await getFinalizedBlockNumber(chainId);
    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(chainId);
    const currentBlock = await client.getBlockNumber();

    const fromBlock = finalizedBlock + 1n;
    const toBlock = currentBlock;

    log.info({
      chainId,
      finalizedBlock: finalizedBlock.toString(),
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
    }, 'Non-finalized close order block range determined');

    if (fromBlock > toBlock) {
      log.info({ chainId }, 'No non-finalized blocks to catch up for close orders');
      return { chainId, eventsPublished: 0, fromBlock, toBlock, durationMs: Date.now() - startTime };
    }

    const events = await fetchHistoricalCloseOrderEvents({
      chainId,
      contractAddresses,
      fromBlock,
      toBlock,
      batchSize: config.batchSizeBlocks,
    });

    let publishedCount = 0;
    const mq = getRabbitMQConnection();

    for (const { event } of events) {
      if (!event) continue;
      try {
        const routingKey = buildCloseOrderRoutingKey(chainId, event.nftId, event.triggerMode);
        const content = serializeCloseOrderEvent(event);
        await mq.publishCloseOrderEvent(routingKey, content);
        publishedCount++;
      } catch (error) {
        log.warn({
          chainId,
          eventType: event.type,
          nftId: event.nftId,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to publish non-finalized close order catch-up event');
      }
    }

    // Do NOT update cached block here (non-finalized blocks can reorg)
    const durationMs = Date.now() - startTime;

    log.info({
      chainId,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      eventsFound: events.length,
      eventsPublished: publishedCount,
      durationMs,
    }, 'Non-finalized close order catch-up completed');

    return { chainId, eventsPublished: publishedCount, fromBlock, toBlock, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ chainId, error: errorMessage, durationMs }, 'Non-finalized close order catch-up failed');
    return { chainId, eventsPublished: 0, fromBlock: 0n, toBlock: 0n, durationMs, error: errorMessage };
  }
}

/**
 * Execute catch-up for FINALIZED blocks.
 * Scans from cachedBlock to finalizedBlock.
 * Safe to run in background.
 */
export async function executeCloseOrderCatchUpFinalized(
  chainId: number,
  contractAddresses: string[]
): Promise<CatchUpResult> {
  const startTime = Date.now();
  const config = getCatchUpConfig();

  log.info({ chainId, contractCount: contractAddresses.length }, 'Starting finalized close order catch-up (background)');

  try {
    const cachedBlock = await getCloseOrderLastProcessedBlock(chainId);

    // Use block 0 as minimum boundary (contracts could be deployed at any point)
    const fromBlock = cachedBlock !== null ? cachedBlock : 0n;

    const finalizedBlock = await getFinalizedBlockNumber(chainId);

    log.info({
      chainId,
      cachedBlock: cachedBlock?.toString() ?? 'none',
      fromBlock: fromBlock.toString(),
      finalizedBlock: finalizedBlock.toString(),
    }, 'Finalized close order block range determined');

    if (fromBlock >= finalizedBlock) {
      log.info({ chainId }, 'No finalized blocks to catch up for close orders');
      return { chainId, eventsPublished: 0, fromBlock, toBlock: finalizedBlock, durationMs: Date.now() - startTime };
    }

    const events = await fetchHistoricalCloseOrderEvents({
      chainId,
      contractAddresses,
      fromBlock,
      toBlock: finalizedBlock,
      batchSize: config.batchSizeBlocks,
    });

    let publishedCount = 0;
    const mq = getRabbitMQConnection();

    for (const { event } of events) {
      if (!event) continue;
      try {
        const routingKey = buildCloseOrderRoutingKey(chainId, event.nftId, event.triggerMode);
        const content = serializeCloseOrderEvent(event);
        await mq.publishCloseOrderEvent(routingKey, content);
        publishedCount++;
      } catch (error) {
        log.warn({
          chainId,
          eventType: event.type,
          nftId: event.nftId,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to publish finalized close order catch-up event');
      }
    }

    // Update cache with finalized block
    await setCloseOrderLastProcessedBlock(chainId, finalizedBlock);

    const durationMs = Date.now() - startTime;

    log.info({
      chainId,
      fromBlock: fromBlock.toString(),
      toBlock: finalizedBlock.toString(),
      eventsFound: events.length,
      eventsPublished: publishedCount,
      durationMs,
    }, 'Finalized close order catch-up completed');

    return { chainId, eventsPublished: publishedCount, fromBlock, toBlock: finalizedBlock, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ chainId, error: errorMessage, durationMs }, 'Finalized close order catch-up failed');
    return { chainId, eventsPublished: 0, fromBlock: 0n, toBlock: 0n, durationMs, error: errorMessage };
  }
}

// ============================================================
// Multi-Chain Wrappers
// ============================================================

/**
 * Execute non-finalized catch-up for multiple chains.
 * Processes sequentially to avoid overwhelming RPC providers.
 */
export async function executeCloseOrderCatchUpNonFinalizedForChains(
  chainContracts: Map<number, string[]>
): Promise<CatchUpResult[]> {
  const config = getCatchUpConfig();
  if (!config.enabled) {
    log.info('Close order catch-up disabled by configuration');
    return [];
  }

  const results: CatchUpResult[] = [];
  for (const [chainId, addresses] of chainContracts) {
    const result = await executeCloseOrderCatchUpNonFinalized(chainId, addresses);
    results.push(result);
  }

  const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
  log.info({ chainsProcessed: results.length, totalEvents }, 'Non-finalized close order catch-up completed for all chains');

  return results;
}

/**
 * Execute finalized catch-up for multiple chains.
 * Processes sequentially to avoid overwhelming RPC providers.
 */
export async function executeCloseOrderCatchUpFinalizedForChains(
  chainContracts: Map<number, string[]>
): Promise<CatchUpResult[]> {
  const config = getCatchUpConfig();
  if (!config.enabled) {
    log.info('Close order catch-up disabled by configuration');
    return [];
  }

  const results: CatchUpResult[] = [];
  for (const [chainId, addresses] of chainContracts) {
    const result = await executeCloseOrderCatchUpFinalized(chainId, addresses);
    results.push(result);
  }

  const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
  log.info({ chainsProcessed: results.length, totalEvents }, 'Finalized close order catch-up completed for all chains');

  return results;
}
