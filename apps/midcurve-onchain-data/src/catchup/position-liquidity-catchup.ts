/**
 * Position Liquidity Catch-Up Orchestrator
 *
 * Coordinates the catch-up process for a chain with reorg-safe ordering:
 *
 * 1. NON-FINALIZED BLOCKS (Phase 1 - blocking):
 *    Scans from (finalizedBlock + 1) to currentBlock.
 *    Must complete before scanner starts normal operation.
 *    These blocks could reorg, so we process them first while scanner buffers.
 *
 * 2. FINALIZED BLOCKS (Phase 3 - background):
 *    Scans from cachedBlock to finalizedBlock.
 *    Safe to run in background since these blocks are immutable.
 */

import { EvmConfig, EvmBlockService, getNfpmDeploymentBlock } from '@midcurve/services';
import { onchainDataLogger } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { buildPositionLiquidityRoutingKey } from '../mq/topology';
import { createRawPositionEvent, serializeRawPositionEvent } from '../mq/position-messages';
import { getLastProcessedBlock, setLastProcessedBlock } from './block-tracker';
import { fetchHistoricalEvents } from './historical-event-fetcher';
import { getCatchUpConfig } from '../lib/config';

const log = onchainDataLogger.child({ component: 'PositionLiquidityCatchUp' });

/**
 * Result of a catch-up operation for a single chain
 */
export interface CatchUpResult {
  chainId: number;
  eventsPublished: number;
  fromBlock: bigint;
  toBlock: bigint;
  durationMs: number;
  error?: string;
}

/**
 * Execute catch-up for a single chain.
 *
 * @param chainId - Chain ID to catch up
 * @param nftIds - NFT IDs (tokenIds) to scan for events
 * @returns Result of the catch-up operation
 */
export async function executeCatchUp(chainId: number, nftIds: string[]): Promise<CatchUpResult> {
  const startTime = Date.now();
  const config = getCatchUpConfig();

  log.info({ chainId, nftIdCount: nftIds.length }, 'Starting catch-up for chain');

  try {
    // 1. Get last processed block from cache
    const cachedBlock = await getLastProcessedBlock(chainId);

    // 2. Get NFPM deployment block as minimum boundary
    let deploymentBlock: bigint;
    try {
      deploymentBlock = getNfpmDeploymentBlock(chainId);
    } catch {
      log.warn({ chainId }, 'NFPM deployment block not found, skipping catch-up');
      return {
        chainId,
        eventsPublished: 0,
        fromBlock: 0n,
        toBlock: 0n,
        durationMs: Date.now() - startTime,
        error: 'NFPM deployment block not found',
      };
    }

    // 3. Determine start block: max(cachedBlock, deploymentBlock)
    const fromBlock = cachedBlock !== null && cachedBlock > deploymentBlock
      ? cachedBlock
      : deploymentBlock;

    // 4. Get current block from RPC
    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(chainId);
    const currentBlock = await client.getBlockNumber();

    log.info({
      chainId,
      cachedBlock: cachedBlock?.toString() ?? 'none',
      deploymentBlock: deploymentBlock.toString(),
      fromBlock: fromBlock.toString(),
      currentBlock: currentBlock.toString(),
    }, 'Determined block range for catch-up');

    // 5. If no gap, skip catch-up
    if (fromBlock >= currentBlock) {
      log.info({ chainId, fromBlock: fromBlock.toString(), currentBlock: currentBlock.toString() }, 'No block gap, skipping catch-up');
      return {
        chainId,
        eventsPublished: 0,
        fromBlock,
        toBlock: currentBlock,
        durationMs: Date.now() - startTime,
      };
    }

    // 6. Fetch historical events
    const events = await fetchHistoricalEvents({
      chainId,
      nftIds,
      fromBlock,
      toBlock: currentBlock,
      batchSize: config.batchSizeBlocks,
    });

    // 7. Publish events to RabbitMQ
    let publishedCount = 0;
    const mq = getRabbitMQConnection();

    for (const event of events) {
      try {
        const routingKey = buildPositionLiquidityRoutingKey(chainId, event.nftId);
        const wrappedEvent = createRawPositionEvent(
          chainId,
          event.nftId,
          event.eventType,
          event.rawLog
        );
        const content = serializeRawPositionEvent(wrappedEvent);
        await mq.publishPositionEvent(routingKey, content);
        publishedCount++;
      } catch (error) {
        log.warn({
          chainId,
          nftId: event.nftId,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to publish catch-up event');
      }
    }

    // 8. Update cache with current block
    await setLastProcessedBlock(chainId, currentBlock);

    const durationMs = Date.now() - startTime;

    log.info({
      chainId,
      fromBlock: fromBlock.toString(),
      toBlock: currentBlock.toString(),
      eventsFound: events.length,
      eventsPublished: publishedCount,
      durationMs,
    }, 'Catch-up completed for chain');

    return {
      chainId,
      eventsPublished: publishedCount,
      fromBlock,
      toBlock: currentBlock,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error({ chainId, error: errorMessage, durationMs }, 'Catch-up failed for chain');

    return {
      chainId,
      eventsPublished: 0,
      fromBlock: 0n,
      toBlock: 0n,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Execute catch-up for multiple chains.
 * Processes chains sequentially to avoid overwhelming RPC providers.
 *
 * @param chainPositions - Map of chainId -> nftIds
 * @returns Results for all chains
 */
export async function executeCatchUpForChains(
  chainPositions: Map<number, string[]>
): Promise<CatchUpResult[]> {
  const config = getCatchUpConfig();

  if (!config.enabled) {
    log.info('Catch-up disabled by configuration');
    return [];
  }

  const results: CatchUpResult[] = [];

  for (const [chainId, nftIds] of chainPositions) {
    const result = await executeCatchUp(chainId, nftIds);
    results.push(result);
  }

  // Log summary
  const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
  const failedChains = results.filter((r) => r.error).length;
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  log.info({
    chainsProcessed: results.length,
    failedChains,
    totalEvents,
    totalDurationMs,
  }, 'Catch-up process completed');

  return results;
}

// =============================================================================
// Reorg-Safe Catch-Up Functions
// =============================================================================

/**
 * Result of a single-position catch-up operation
 */
export interface SinglePositionCatchUpResult {
  chainId: number;
  nftId: string;
  eventsPublished: number;
  fromBlock: bigint;
  toBlock: bigint;
  durationMs: number;
  error?: string;
}

/**
 * Safety margins (in blocks) for chains when finalized block is unavailable.
 * Used as fallback: pseudoFinalizedBlock = currentBlock - safetyMargin
 */
const FINALITY_SAFETY_MARGINS: Record<number, bigint> = {
  1: 64n,      // Ethereum: ~13 minutes (64 blocks × 12s)
  42161: 64n,  // Arbitrum: conservative margin
  8453: 64n,   // Base
  56: 64n,     // BSC
  137: 128n,   // Polygon: longer due to reorg history
  10: 64n,     // Optimism
};

/**
 * Get the finalized block number for a chain.
 * Falls back to safety margin if RPC doesn't support finalized tag.
 */
async function getFinalizedBlockNumber(chainId: number): Promise<bigint> {
  const evmBlockService = new EvmBlockService();
  const evmConfig = EvmConfig.getInstance();

  let finalizedBlock = await evmBlockService.getLastFinalizedBlockNumber(chainId);

  if (finalizedBlock === null) {
    // Fallback: use current block minus safety margin
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

/**
 * Execute catch-up for NON-FINALIZED blocks only.
 * Scans from (finalizedBlock + 1) to currentBlock.
 *
 * This must run while the scanner is in buffering mode to catch any reorgs.
 *
 * @param chainId - Chain ID to catch up
 * @param nftIds - NFT IDs (tokenIds) to scan for events
 * @returns Result of the catch-up operation
 */
export async function executeCatchUpNonFinalized(
  chainId: number,
  nftIds: string[]
): Promise<CatchUpResult> {
  const startTime = Date.now();
  const config = getCatchUpConfig();

  log.info({ chainId, nftIdCount: nftIds.length }, 'Starting non-finalized block catch-up');

  try {
    // 1. Get finalized block (boundary)
    const finalizedBlock = await getFinalizedBlockNumber(chainId);

    // 2. Get current block from RPC
    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(chainId);
    const currentBlock = await client.getBlockNumber();

    // 3. Calculate range: (finalizedBlock + 1) to currentBlock
    const fromBlock = finalizedBlock + 1n;
    const toBlock = currentBlock;

    log.info({
      chainId,
      finalizedBlock: finalizedBlock.toString(),
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
    }, 'Non-finalized block range determined');

    // 4. If no gap (finalizedBlock >= currentBlock), skip
    if (fromBlock > toBlock) {
      log.info({ chainId }, 'No non-finalized blocks to catch up');
      return {
        chainId,
        eventsPublished: 0,
        fromBlock,
        toBlock,
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Fetch historical events for non-finalized range
    const events = await fetchHistoricalEvents({
      chainId,
      nftIds,
      fromBlock,
      toBlock,
      batchSize: config.batchSizeBlocks,
    });

    // 6. Publish events to RabbitMQ
    let publishedCount = 0;
    const mq = getRabbitMQConnection();

    for (const event of events) {
      try {
        const routingKey = buildPositionLiquidityRoutingKey(chainId, event.nftId);
        const wrappedEvent = createRawPositionEvent(
          chainId,
          event.nftId,
          event.eventType,
          event.rawLog
        );
        const content = serializeRawPositionEvent(wrappedEvent);
        await mq.publishPositionEvent(routingKey, content);
        publishedCount++;
      } catch (error) {
        log.warn({
          chainId,
          nftId: event.nftId,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to publish non-finalized catch-up event');
      }
    }

    // Note: We do NOT update the cached block here.
    // The cached block tracks finalized progress, not non-finalized.

    const durationMs = Date.now() - startTime;

    log.info({
      chainId,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      eventsFound: events.length,
      eventsPublished: publishedCount,
      durationMs,
    }, 'Non-finalized block catch-up completed');

    return {
      chainId,
      eventsPublished: publishedCount,
      fromBlock,
      toBlock,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error({ chainId, error: errorMessage, durationMs }, 'Non-finalized catch-up failed');

    return {
      chainId,
      eventsPublished: 0,
      fromBlock: 0n,
      toBlock: 0n,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Execute catch-up for FINALIZED blocks only.
 * Scans from cachedBlock (or deployment block) to finalizedBlock.
 *
 * Safe to run in background since finalized blocks are immutable.
 *
 * @param chainId - Chain ID to catch up
 * @param nftIds - NFT IDs (tokenIds) to scan for events
 * @returns Result of the catch-up operation
 */
export async function executeCatchUpFinalized(
  chainId: number,
  nftIds: string[]
): Promise<CatchUpResult> {
  const startTime = Date.now();
  const config = getCatchUpConfig();

  log.info({ chainId, nftIdCount: nftIds.length }, 'Starting finalized block catch-up (background)');

  try {
    // 1. Get last processed block from cache
    const cachedBlock = await getLastProcessedBlock(chainId);

    // 2. Get NFPM deployment block as minimum boundary
    let deploymentBlock: bigint;
    try {
      deploymentBlock = getNfpmDeploymentBlock(chainId);
    } catch {
      log.warn({ chainId }, 'NFPM deployment block not found, skipping finalized catch-up');
      return {
        chainId,
        eventsPublished: 0,
        fromBlock: 0n,
        toBlock: 0n,
        durationMs: Date.now() - startTime,
        error: 'NFPM deployment block not found',
      };
    }

    // 3. Determine start block: max(cachedBlock, deploymentBlock)
    const fromBlock = cachedBlock !== null && cachedBlock > deploymentBlock
      ? cachedBlock
      : deploymentBlock;

    // 4. Get finalized block (upper boundary for this phase)
    const finalizedBlock = await getFinalizedBlockNumber(chainId);

    log.info({
      chainId,
      cachedBlock: cachedBlock?.toString() ?? 'none',
      deploymentBlock: deploymentBlock.toString(),
      fromBlock: fromBlock.toString(),
      finalizedBlock: finalizedBlock.toString(),
    }, 'Finalized block range determined');

    // 5. If no gap (fromBlock >= finalizedBlock), skip
    if (fromBlock >= finalizedBlock) {
      log.info({ chainId }, 'No finalized blocks to catch up');
      return {
        chainId,
        eventsPublished: 0,
        fromBlock,
        toBlock: finalizedBlock,
        durationMs: Date.now() - startTime,
      };
    }

    // 6. Fetch historical events for finalized range
    const events = await fetchHistoricalEvents({
      chainId,
      nftIds,
      fromBlock,
      toBlock: finalizedBlock,
      batchSize: config.batchSizeBlocks,
    });

    // 7. Publish events to RabbitMQ
    let publishedCount = 0;
    const mq = getRabbitMQConnection();

    for (const event of events) {
      try {
        const routingKey = buildPositionLiquidityRoutingKey(chainId, event.nftId);
        const wrappedEvent = createRawPositionEvent(
          chainId,
          event.nftId,
          event.eventType,
          event.rawLog
        );
        const content = serializeRawPositionEvent(wrappedEvent);
        await mq.publishPositionEvent(routingKey, content);
        publishedCount++;
      } catch (error) {
        log.warn({
          chainId,
          nftId: event.nftId,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to publish finalized catch-up event');
      }
    }

    // 8. Update cache with finalized block
    await setLastProcessedBlock(chainId, finalizedBlock);

    const durationMs = Date.now() - startTime;

    log.info({
      chainId,
      fromBlock: fromBlock.toString(),
      toBlock: finalizedBlock.toString(),
      eventsFound: events.length,
      eventsPublished: publishedCount,
      durationMs,
    }, 'Finalized block catch-up completed');

    return {
      chainId,
      eventsPublished: publishedCount,
      fromBlock,
      toBlock: finalizedBlock,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error({ chainId, error: errorMessage, durationMs }, 'Finalized catch-up failed');

    return {
      chainId,
      eventsPublished: 0,
      fromBlock: 0n,
      toBlock: 0n,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Execute catch-up for NON-FINALIZED blocks for a SINGLE position.
 * Used when a new position is added at runtime.
 *
 * This should be called while the position's events are being buffered
 * to ensure no events are missed during the scan.
 *
 * @param chainId - Chain ID of the position
 * @param nftId - NFT ID (tokenId) to scan for events
 * @returns Result of the catch-up operation
 */
export async function executeSinglePositionCatchUpNonFinalized(
  chainId: number,
  nftId: string
): Promise<SinglePositionCatchUpResult> {
  const startTime = Date.now();
  const config = getCatchUpConfig();

  log.info({ chainId, nftId }, 'Starting single-position non-finalized block catch-up');

  try {
    // 1. Get finalized block (boundary)
    const finalizedBlock = await getFinalizedBlockNumber(chainId);

    // 2. Get current block from RPC
    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(chainId);
    const currentBlock = await client.getBlockNumber();

    // 3. Calculate range: (finalizedBlock + 1) to currentBlock
    const fromBlock = finalizedBlock + 1n;
    const toBlock = currentBlock;

    log.info({
      chainId,
      nftId,
      finalizedBlock: finalizedBlock.toString(),
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
    }, 'Single-position non-finalized block range determined');

    // 4. If no gap, skip
    if (fromBlock > toBlock) {
      log.info({ chainId, nftId }, 'No non-finalized blocks to catch up for position');
      return {
        chainId,
        nftId,
        eventsPublished: 0,
        fromBlock,
        toBlock,
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Fetch historical events for this single position
    const events = await fetchHistoricalEvents({
      chainId,
      nftIds: [nftId],
      fromBlock,
      toBlock,
      batchSize: config.batchSizeBlocks,
    });

    // 6. Publish events to RabbitMQ
    let publishedCount = 0;
    const mq = getRabbitMQConnection();

    for (const event of events) {
      try {
        const routingKey = buildPositionLiquidityRoutingKey(chainId, event.nftId);
        const wrappedEvent = createRawPositionEvent(
          chainId,
          event.nftId,
          event.eventType,
          event.rawLog
        );
        const content = serializeRawPositionEvent(wrappedEvent);
        await mq.publishPositionEvent(routingKey, content);
        publishedCount++;
      } catch (error) {
        log.warn({
          chainId,
          nftId: event.nftId,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to publish single-position non-finalized catch-up event');
      }
    }

    const durationMs = Date.now() - startTime;

    log.info({
      chainId,
      nftId,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      eventsFound: events.length,
      eventsPublished: publishedCount,
      durationMs,
    }, 'Single-position non-finalized block catch-up completed');

    return {
      chainId,
      nftId,
      eventsPublished: publishedCount,
      fromBlock,
      toBlock,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error({ chainId, nftId, error: errorMessage, durationMs }, 'Single-position non-finalized catch-up failed');

    return {
      chainId,
      nftId,
      eventsPublished: 0,
      fromBlock: 0n,
      toBlock: 0n,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Execute non-finalized catch-up for multiple chains.
 * Processes chains sequentially to avoid overwhelming RPC providers.
 *
 * @param chainPositions - Map of chainId -> nftIds
 * @returns Results for all chains
 */
export async function executeCatchUpNonFinalizedForChains(
  chainPositions: Map<number, string[]>
): Promise<CatchUpResult[]> {
  const config = getCatchUpConfig();

  if (!config.enabled) {
    log.info('Non-finalized catch-up disabled by configuration');
    return [];
  }

  const results: CatchUpResult[] = [];

  for (const [chainId, nftIds] of chainPositions) {
    const result = await executeCatchUpNonFinalized(chainId, nftIds);
    results.push(result);
  }

  // Log summary
  const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
  const failedChains = results.filter((r) => r.error).length;
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  log.info({
    chainsProcessed: results.length,
    failedChains,
    totalEvents,
    totalDurationMs,
  }, 'Non-finalized catch-up process completed');

  return results;
}

/**
 * Execute finalized catch-up for multiple chains.
 * Processes chains sequentially to avoid overwhelming RPC providers.
 *
 * @param chainPositions - Map of chainId -> nftIds
 * @returns Results for all chains
 */
export async function executeCatchUpFinalizedForChains(
  chainPositions: Map<number, string[]>
): Promise<CatchUpResult[]> {
  const config = getCatchUpConfig();

  if (!config.enabled) {
    log.info('Finalized catch-up disabled by configuration');
    return [];
  }

  const results: CatchUpResult[] = [];

  for (const [chainId, nftIds] of chainPositions) {
    const result = await executeCatchUpFinalized(chainId, nftIds);
    results.push(result);
  }

  // Log summary
  const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
  const failedChains = results.filter((r) => r.error).length;
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  log.info({
    chainsProcessed: results.length,
    failedChains,
    totalEvents,
    totalDurationMs,
  }, 'Finalized catch-up process completed');

  return results;
}
