/**
 * PositionLiquiditySubscriber Worker
 *
 * Loads active UniswapV3 positions from database, creates WebSocket subscription batches,
 * and manages their lifecycle. Publishes incoming NFPM events (IncreaseLiquidity,
 * DecreaseLiquidity, Collect) to RabbitMQ.
 */

import { prisma } from '@midcurve/database';
import type { PositionJSON } from '@midcurve/shared';
import { EvmConfig } from '@midcurve/services';
import { onchainDataLogger, priceLog } from '../lib/logger';
import {
  getConfiguredWssUrls,
  getWssUrl,
  getWorkerConfig,
  getCatchUpConfig,
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config';
import {
  UniswapV3NfpmSubscriptionBatch,
  createUniswapV3NfpmSubscriptionBatches,
  type PositionInfo,
} from '../ws/providers/uniswap-v3-nfpm';
import {
  executeCatchUpNonFinalizedForChains,
  executeCatchUpFinalizedForChains,
  executeSinglePositionCatchUpNonFinalized,
  updateBlockIfHigher,
  setLastProcessedBlock,
} from '../catchup';

const log = onchainDataLogger.child({ component: 'PositionLiquiditySubscriber' });

/**
 * Position configuration from database JSON field.
 */
interface PositionConfig {
  chainId: number;
  nftId: number;
  poolAddress: string;
}

/**
 * PositionLiquiditySubscriber manages WebSocket subscriptions for position liquidity events.
 */
export class PositionLiquiditySubscriber {
  private batches: UniswapV3NfpmSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, UniswapV3NfpmSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Cleanup state (safety net for missed events)
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Block tracking state (for catch-up on restart)
  private blockTrackingTimer: NodeJS.Timeout | null = null;

  // Track all subscribed positions by nftId for quick lookup
  private subscribedPositions: Map<string, { chainId: SupportedChainId; positionId: string }> =
    new Map();

  /**
   * Start the subscriber.
   * Loads active positions, creates WebSocket batches, and performs reorg-safe catch-up.
   *
   * Catch-up flow (reorg-safe):
   * 1. Create WebSocket batches in BUFFERING mode
   * 2. Start WebSocket subscriptions (events buffered, not published)
   * 3. Scan NON-FINALIZED blocks (finalizedBlock+1 → currentBlock)
   * 4. Flush buffered events and switch to normal mode
   * 5. Start cleanup and block tracking
   * 6. Scan FINALIZED blocks in background (cachedBlock → finalizedBlock)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'starting');

    try {
      // 1. Load active positions from database
      const positionsByChain = await this.loadActivePositions();

      // Get configured WSS URLs
      const wssConfigs = getConfiguredWssUrls();

      if (wssConfigs.length === 0) {
        log.warn({
          msg: 'No WS_RPC_URL_* environment variables configured, subscriber will not start. Set WS_RPC_URL_ETHEREUM, WS_RPC_URL_ARBITRUM, etc.',
        });
        return;
      }

      // 2. Create subscription batches for each configured chain
      for (const wssConfig of wssConfigs) {
        const chainId = wssConfig.chainId as SupportedChainId;
        const positions = positionsByChain.get(chainId);

        if (!positions || positions.length === 0) {
          log.info({ chainId, msg: 'No active positions for chain, skipping' });
          continue;
        }

        const chainBatches = createUniswapV3NfpmSubscriptionBatches(chainId, wssConfig.url, positions);
        this.batches.push(...chainBatches);
        this.batchesByChain.set(chainId, chainBatches);

        // Track all subscribed positions
        for (const position of positions) {
          this.subscribedPositions.set(position.nftId, {
            chainId,
            positionId: position.positionId,
          });
        }
      }

      this.isRunning = true;

      // Set block update callback on all batches for block tracking
      for (const batch of this.batches) {
        batch.setBlockUpdateCallback((chainId, blockNumber) => {
          this.handleBlockUpdate(chainId, blockNumber);
        });
      }

      if (this.batches.length === 0) {
        log.warn({ msg: 'No subscription batches created, subscriber will idle' });
      } else {
        // 3. Execute reorg-safe catch-up with buffering
        await this.catchUpNonFinalizedBlocksWithBuffering(positionsByChain);
      }

      // 5. Start cleanup timer (safety net for missed events)
      this.startCleanup();

      // Start block tracking heartbeat
      this.startBlockTracking();

      const totalPositions = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().positionCount,
        0
      );

      priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'started', {
        batchCount: this.batches.length,
        totalPositions,
      });

      // 6. Execute FINALIZED block catch-up in background
      // Safe since finalized blocks are immutable
      this.catchUpFinalizedBlocksInBackground(positionsByChain);
    } catch (error) {
      priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the subscriber.
   * Stops all WebSocket batches gracefully.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'Subscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'stopping');

    // Stop cleanup timer
    this.stopCleanup();

    // Stop block tracking timer
    this.stopBlockTracking();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.subscribedPositions.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    batchCount: number;
    batches: Array<{
      chainId: number;
      batchIndex: number;
      positionCount: number;
      isConnected: boolean;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      batchCount: this.batches.length,
      batches: this.batches.map((batch) => batch.getStatus()),
    };
  }

  /**
   * Load active UniswapV3 positions from database, grouped by chain ID.
   */
  private async loadActivePositions(): Promise<Map<SupportedChainId, PositionInfo[]>> {
    priceLog.methodEntry(log, 'loadActivePositions');

    // Query active UniswapV3 positions
    const positions = await prisma.position.findMany({
      where: {
        isActive: true,
        protocol: 'uniswapv3',
      },
      select: {
        id: true,
        config: true,
      },
    });

    log.info({ positionCount: positions.length, msg: 'Loaded active positions' });

    // Group positions by chain ID
    const positionsByChain = new Map<SupportedChainId, PositionInfo[]>();

    for (const position of positions) {
      const config = position.config as unknown as PositionConfig;

      if (!config.chainId || config.nftId === undefined) {
        log.warn({ positionId: position.id, msg: 'Position config missing chainId or nftId' });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({
          chainId: config.chainId,
          positionId: position.id,
          msg: 'Unsupported chain ID',
        });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;

      if (!positionsByChain.has(chainId)) {
        positionsByChain.set(chainId, []);
      }

      positionsByChain.get(chainId)!.push({
        nftId: String(config.nftId),
        positionId: position.id,
      });
    }

    // Log summary
    for (const [chainId, chainPositions] of positionsByChain) {
      log.info({ chainId, positionCount: chainPositions.length, msg: 'Positions grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActivePositions');

    return positionsByChain;
  }

  // ===========================================================================
  // Position Batch Management
  // ===========================================================================

  /**
   * Remove a position from its batch.
   */
  private async removePositionFromBatch(
    chainId: SupportedChainId,
    nftId: string,
    positionId: string
  ): Promise<void> {
    const chainBatches = this.batchesByChain.get(chainId);
    if (!chainBatches) return;

    for (const batch of chainBatches) {
      if (batch.hasPosition(nftId)) {
        await batch.removePosition(nftId);
        this.subscribedPositions.delete(nftId);
        log.info({
          nftId,
          positionId,
          chainId,
          msg: 'Removed closed position from subscription',
        });
        break;
      }
    }
  }

  // ===========================================================================
  // Cleanup inactive positions
  // ===========================================================================

  /**
   * Start the cleanup timer for inactive positions.
   */
  private startCleanup(): void {
    const config = getWorkerConfig();

    this.cleanupTimer = setInterval(() => {
      this.cleanupInactivePositions().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error cleaning up inactive positions',
        });
      });
    }, config.cleanupIntervalMs);

    log.info({ intervalMs: config.cleanupIntervalMs, msg: 'Started inactive position cleanup' });
  }

  /**
   * Stop the cleanup timer.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped inactive position cleanup' });
    }
  }

  /**
   * Clean up positions that are no longer active.
   * Removes them from WebSocket subscriptions.
   */
  private async cleanupInactivePositions(): Promise<void> {
    if (this.subscribedPositions.size === 0) {
      return;
    }

    // Get all currently subscribed position IDs
    const subscribedPositionIds = Array.from(this.subscribedPositions.values()).map(
      (p) => p.positionId
    );

    // Find which of these positions are still active
    const activePositions = await prisma.position.findMany({
      where: {
        id: { in: subscribedPositionIds },
        isActive: true,
        protocol: 'uniswapv3',
      },
      select: { id: true },
    });

    const activePositionIds = new Set(activePositions.map((p) => p.id));

    // Find positions to remove (subscribed but no longer active)
    const toRemove: Array<{ nftId: string; chainId: SupportedChainId; positionId: string }> = [];

    for (const [nftId, info] of this.subscribedPositions) {
      if (!activePositionIds.has(info.positionId)) {
        toRemove.push({ nftId, chainId: info.chainId, positionId: info.positionId });
      }
    }

    if (toRemove.length === 0) {
      return;
    }

    log.info({ count: toRemove.length, msg: 'Found inactive positions to remove from subscriptions' });

    // Remove from batches using helper
    for (const { nftId, chainId, positionId } of toRemove) {
      await this.removePositionFromBatch(chainId, nftId, positionId);
    }
  }

  // ===========================================================================
  // Block Tracking (for catch-up on restart)
  // ===========================================================================

  /**
   * Start the block tracking heartbeat timer.
   * Periodically updates the last processed block for each chain to prevent
   * large scan ranges on restart when there's no position activity.
   */
  private startBlockTracking(): void {
    const config = getCatchUpConfig();

    if (!config.enabled) {
      log.info({ msg: 'Block tracking disabled (catch-up disabled)' });
      return;
    }

    this.blockTrackingTimer = setInterval(() => {
      this.updateBlockTrackingHeartbeat().catch((err) => {
        log.warn({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Block tracking heartbeat failed',
        });
      });
    }, config.heartbeatIntervalMs);

    log.info({ intervalMs: config.heartbeatIntervalMs, msg: 'Started block tracking heartbeat' });
  }

  /**
   * Stop the block tracking heartbeat timer.
   */
  private stopBlockTracking(): void {
    if (this.blockTrackingTimer) {
      clearInterval(this.blockTrackingTimer);
      this.blockTrackingTimer = null;
      log.info({ msg: 'Stopped block tracking heartbeat' });
    }
  }

  /**
   * Handle block update from WebSocket event.
   * Updates the cached block if the new block is higher.
   */
  private handleBlockUpdate(chainId: number, blockNumber: bigint): void {
    // Fire and forget - don't block event processing
    updateBlockIfHigher(chainId, blockNumber).catch((err) => {
      log.warn({
        chainId,
        blockNumber: blockNumber.toString(),
        error: err instanceof Error ? err.message : String(err),
        msg: 'Failed to update block tracking from event',
      });
    });
  }

  /**
   * Heartbeat update for block tracking.
   * Fetches current block number for each chain and updates the cache.
   */
  private async updateBlockTrackingHeartbeat(): Promise<void> {
    const evmConfig = EvmConfig.getInstance();

    for (const [chainId] of this.batchesByChain) {
      try {
        const client = evmConfig.getPublicClient(chainId);
        const currentBlock = await client.getBlockNumber();
        await setLastProcessedBlock(chainId, currentBlock);
        log.debug({ chainId, blockNumber: currentBlock.toString(), msg: 'Block tracking heartbeat' });
      } catch (err) {
        log.warn({
          chainId,
          error: err instanceof Error ? err.message : String(err),
          msg: 'Failed to update block tracking heartbeat',
        });
      }
    }
  }

  /**
   * Catch up non-finalized blocks while WebSocket buffers incoming events.
   *
   * Flow:
   * 1. Enable buffering on all batches
   * 2. Start WebSocket subscriptions (events go to buffer)
   * 3. Scan non-finalized blocks (finalizedBlock+1 → currentBlock)
   * 4. Flush buffered events and switch to normal mode
   */
  private async catchUpNonFinalizedBlocksWithBuffering(
    positionsByChain: Map<SupportedChainId, PositionInfo[]>
  ): Promise<void> {
    const config = getCatchUpConfig();

    // 1. Enable buffering on all batches
    for (const batch of this.batches) {
      batch.enableBuffering();
    }

    // 2. Start WebSocket subscriptions (events will be buffered)
    log.info({ msg: 'Starting WebSocket subscriptions in buffering mode' });
    await Promise.all(this.batches.map((batch) => batch.start()));

    // 3. Scan non-finalized blocks if catch-up is enabled
    if (config.enabled) {
      // Convert to chainId -> nftIds map for catch-up
      const chainNftIds = new Map<number, string[]>();
      for (const [chainId, positions] of positionsByChain) {
        chainNftIds.set(chainId, positions.map((p) => p.nftId));
      }

      log.info({ msg: 'Scanning non-finalized blocks (blocking)' });
      const results = await executeCatchUpNonFinalizedForChains(chainNftIds);

      const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
      const failedChains = results.filter((r) => r.error).length;
      log.info({
        chainsProcessed: results.length,
        failedChains,
        totalEvents,
        msg: 'Non-finalized block catch-up completed',
      });
    }

    // 4. Flush buffered events and switch to normal mode
    let totalFlushed = 0;
    for (const batch of this.batches) {
      const flushed = await batch.flushBufferAndDisableBuffering();
      totalFlushed += flushed;
    }

    log.info({
      totalFlushedEvents: totalFlushed,
      msg: 'Buffered events flushed, scanner now in normal mode',
    });
  }

  /**
   * Execute finalized block catch-up in background.
   * Safe to run in background since finalized blocks are immutable.
   */
  private catchUpFinalizedBlocksInBackground(
    positionsByChain: Map<SupportedChainId, PositionInfo[]>
  ): void {
    const config = getCatchUpConfig();

    if (!config.enabled) {
      log.info({ msg: 'Finalized block catch-up disabled by configuration' });
      return;
    }

    // Convert to chainId -> nftIds map for catch-up
    const chainNftIds = new Map<number, string[]>();
    for (const [chainId, positions] of positionsByChain) {
      chainNftIds.set(chainId, positions.map((p) => p.nftId));
    }

    // Execute finalized catch-up in background (fire and forget)
    log.info({ msg: 'Starting finalized block catch-up in background' });
    executeCatchUpFinalizedForChains(chainNftIds)
      .then((results) => {
        const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
        const failedChains = results.filter((r) => r.error).length;
        log.info({
          chainsProcessed: results.length,
          failedChains,
          totalEvents,
          msg: 'Background finalized block catch-up completed',
        });
      })
      .catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Background finalized block catch-up failed',
        });
      });
  }

  // ===========================================================================
  // Domain Event Handlers
  // ===========================================================================

  /**
   * Handle position.created domain event.
   * Adds the position to WebSocket subscriptions with reorg-safe catch-up.
   *
   * Flow (reorg-safe):
   * 1. Enable per-position buffering for the new nftId
   * 2. Add position to batch (triggers WebSocket reconnect)
   * 3. Scan non-finalized blocks for this position
   * 4. Flush buffered events and disable buffering
   *
   * @param payload - Position data from the domain event
   */
  async handlePositionCreated(payload: PositionJSON): Promise<void> {
    // 1. Filter by protocol - only handle UniswapV3 positions
    if (payload.protocol !== 'uniswapv3') {
      log.debug({ protocol: payload.protocol, positionId: payload.id }, 'Ignoring non-UniswapV3 position');
      return;
    }

    // 2. Extract and validate config
    const config = payload.config as unknown as PositionConfig;
    if (!config.chainId || config.nftId === undefined) {
      log.warn({ positionId: payload.id }, 'Position config missing chainId or nftId');
      return;
    }

    // 3. Validate chain support
    if (!isSupportedChain(config.chainId)) {
      log.debug({ chainId: config.chainId, positionId: payload.id }, 'Unsupported chain, ignoring');
      return;
    }

    const chainId = config.chainId as SupportedChainId;
    const nftId = String(config.nftId);

    // 4. Skip if already subscribed (idempotency)
    if (this.subscribedPositions.has(nftId)) {
      log.debug({ nftId, positionId: payload.id }, 'Position already subscribed, skipping');
      return;
    }

    // 5. Get WSS URL for chain
    const wssUrl = getWssUrl(chainId);
    if (!wssUrl) {
      log.warn({ chainId, positionId: payload.id }, 'No WSS URL configured for chain');
      return;
    }

    const positionInfo: PositionInfo = {
      nftId,
      positionId: payload.id,
    };

    log.info({ chainId, nftId, positionId: payload.id }, 'Adding position from created event with reorg-safe catch-up');

    // 6. Find or create batch for this chain, enable per-position buffering
    const batch = await this.addPositionToBatchWithBuffering(chainId, wssUrl, positionInfo);

    if (!batch) {
      log.warn({ chainId, nftId, positionId: payload.id }, 'Failed to add position to batch');
      return;
    }

    // 7. Scan non-finalized blocks for this position (while events are buffered)
    const catchUpConfig = getCatchUpConfig();
    if (catchUpConfig.enabled) {
      log.info({ chainId, nftId }, 'Scanning non-finalized blocks for new position');
      const result = await executeSinglePositionCatchUpNonFinalized(chainId, nftId);
      log.info({
        chainId,
        nftId,
        eventsPublished: result.eventsPublished,
        error: result.error,
      }, 'Single-position non-finalized catch-up completed');
    }

    // 8. Flush buffered events and disable buffering for this position
    const flushedCount = await batch.flushPositionBufferAndDisableBuffering(nftId);
    log.info({
      chainId,
      nftId,
      flushedEvents: flushedCount,
    }, 'Position catch-up complete, now in normal mode');
  }

  /**
   * Add a position to a batch with per-position buffering enabled.
   * Returns the batch so we can flush the buffer after catch-up.
   */
  private async addPositionToBatchWithBuffering(
    chainId: SupportedChainId,
    wssUrl: string,
    position: PositionInfo
  ): Promise<UniswapV3NfpmSubscriptionBatch | null> {
    let chainBatches = this.batchesByChain.get(chainId);

    if (!chainBatches) {
      chainBatches = [];
      this.batchesByChain.set(chainId, chainBatches);
    }

    // Find a batch with room
    let targetBatch = chainBatches.find((batch) => batch.hasCapacity());

    if (targetBatch) {
      // Enable per-position buffering BEFORE adding (so events are captured during reconnect)
      targetBatch.enableBufferingForPosition(position.nftId);

      // Add to existing batch (triggers reconnect)
      await targetBatch.addPosition(position);
      this.subscribedPositions.set(position.nftId, { chainId, positionId: position.positionId });
      log.info({
        chainId,
        nftId: position.nftId,
        batchIndex: targetBatch.getStatus().batchIndex,
        msg: 'Added position to existing batch with buffering',
      });
      return targetBatch;
    } else {
      // Create new batch with buffering enabled for this position
      const batchIndex = chainBatches.length;
      const newBatch = new UniswapV3NfpmSubscriptionBatch(chainId, wssUrl, batchIndex, [position]);

      // Enable per-position buffering
      newBatch.enableBufferingForPosition(position.nftId);

      // Set block update callback
      newBatch.setBlockUpdateCallback((cid, blockNumber) => {
        this.handleBlockUpdate(cid, blockNumber);
      });

      chainBatches.push(newBatch);
      this.batches.push(newBatch);
      this.subscribedPositions.set(position.nftId, { chainId, positionId: position.positionId });

      // Start the new batch
      await newBatch.start();
      log.info({ chainId, nftId: position.nftId, batchIndex, msg: 'Created new batch for position with buffering' });
      return newBatch;
    }
  }

  /**
   * Handle position.closed domain event.
   * Removes the position from WebSocket subscriptions.
   *
   * @param chainId - Chain ID from routing key
   * @param nftId - NFT ID from routing key
   */
  async handlePositionClosed(chainId: number, nftId: string): Promise<void> {
    // 1. Validate chain support
    if (!isSupportedChain(chainId)) {
      log.debug({ chainId, nftId }, 'Unsupported chain, ignoring');
      return;
    }

    // 2. Look up subscription info
    const info = this.subscribedPositions.get(nftId);
    if (!info) {
      log.debug({ chainId, nftId }, 'Position not subscribed, skipping');
      return;
    }

    // 3. Verify chain matches (extra safety check)
    if (info.chainId !== chainId) {
      log.warn(
        { expectedChainId: info.chainId, actualChainId: chainId, nftId },
        'Chain ID mismatch for position'
      );
    }

    // 4. Remove from subscription
    log.info({ chainId: info.chainId, nftId, positionId: info.positionId }, 'Removing position from closed event');
    await this.removePositionFromBatch(info.chainId, nftId, info.positionId);
  }

  /**
   * Handle position.deleted domain event.
   * Removes the position from WebSocket subscriptions.
   *
   * @param chainId - Chain ID from routing key
   * @param nftId - NFT ID from routing key
   */
  async handlePositionDeleted(chainId: number, nftId: string): Promise<void> {
    // 1. Validate chain support
    if (!isSupportedChain(chainId)) {
      log.debug({ chainId, nftId }, 'Unsupported chain, ignoring');
      return;
    }

    // 2. Look up subscription info
    const info = this.subscribedPositions.get(nftId);
    if (!info) {
      log.debug({ chainId, nftId }, 'Position not subscribed, skipping');
      return;
    }

    // 3. Verify chain matches (extra safety check)
    if (info.chainId !== chainId) {
      log.warn(
        { expectedChainId: info.chainId, actualChainId: chainId, nftId },
        'Chain ID mismatch for position'
      );
    }

    // 4. Remove from subscription
    log.info({ chainId: info.chainId, nftId, positionId: info.positionId }, 'Removing position from deleted event');
    await this.removePositionFromBatch(info.chainId, nftId, info.positionId);
  }
}
