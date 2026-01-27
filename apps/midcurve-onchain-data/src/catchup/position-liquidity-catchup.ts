/**
 * Position Liquidity Catch-Up Orchestrator
 *
 * Coordinates the catch-up process for a chain:
 * 1. Get last processed block from cache
 * 2. Determine start block (max of cache or NFPM deployment)
 * 3. Get current block from RPC
 * 4. Fetch historical events via getLogs
 * 5. Publish events to RabbitMQ
 * 6. Update cache with current block
 */

import { EvmConfig, getNfpmDeploymentBlock } from '@midcurve/services';
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
