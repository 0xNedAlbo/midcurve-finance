/**
 * PositionLiquiditySubscriber Worker
 *
 * Loads active UniswapV3 positions from database, creates WebSocket subscription batches,
 * and manages their lifecycle. Publishes incoming NFPM events (IncreaseLiquidity,
 * DecreaseLiquidity, Collect) to RabbitMQ.
 */

import { prisma } from '@midcurve/database';
import type { PositionJSON } from '@midcurve/shared';
import { onchainDataLogger, priceLog } from '../lib/logger';
import {
  getConfiguredWssUrls,
  getWssUrl,
  getWorkerConfig,
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config';
import {
  UniswapV3NfpmSubscriptionBatch,
  createUniswapV3NfpmSubscriptionBatches,
  type PositionInfo,
} from '../ws/providers/uniswap-v3-nfpm';

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

  // Track all subscribed positions by nftId for quick lookup
  private subscribedPositions: Map<string, { chainId: SupportedChainId; positionId: string }> =
    new Map();

  /**
   * Start the subscriber.
   * Loads active positions and creates WebSocket batches.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'starting');

    try {
      // Load active positions from database
      const positionsByChain = await this.loadActivePositions();

      // Get configured WSS URLs
      const wssConfigs = getConfiguredWssUrls();

      if (wssConfigs.length === 0) {
        log.warn({
          msg: 'No WS_RPC_URL_* environment variables configured, subscriber will not start. Set WS_RPC_URL_ETHEREUM, WS_RPC_URL_ARBITRUM, etc.',
        });
        return;
      }

      // Create subscription batches for each configured chain
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

      if (this.batches.length === 0) {
        log.warn({ msg: 'No subscription batches created, subscriber will idle' });
      } else {
        // Start all batches
        await Promise.all(this.batches.map((batch) => batch.start()));
      }

      // Start cleanup timer (safety net for missed events)
      this.startCleanup();

      const totalPositions = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().positionCount,
        0
      );

      priceLog.workerLifecycle(log, 'PositionLiquiditySubscriber', 'started', {
        batchCount: this.batches.length,
        totalPositions,
      });
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
   * Add a position to an existing batch or create a new batch if needed.
   */
  private async addPositionToBatch(
    chainId: SupportedChainId,
    wssUrl: string,
    position: PositionInfo
  ): Promise<void> {
    let chainBatches = this.batchesByChain.get(chainId);

    if (!chainBatches) {
      chainBatches = [];
      this.batchesByChain.set(chainId, chainBatches);
    }

    // Find a batch with room
    let targetBatch = chainBatches.find((batch) => batch.hasCapacity());

    if (targetBatch) {
      // Add to existing batch
      await targetBatch.addPosition(position);
      this.subscribedPositions.set(position.nftId, { chainId, positionId: position.positionId });
      log.info({
        chainId,
        nftId: position.nftId,
        batchIndex: targetBatch.getStatus().batchIndex,
        msg: 'Added position to existing batch',
      });
    } else {
      // Create new batch
      const batchIndex = chainBatches.length;
      const newBatch = new UniswapV3NfpmSubscriptionBatch(chainId, wssUrl, batchIndex, [position]);
      chainBatches.push(newBatch);
      this.batches.push(newBatch);
      this.subscribedPositions.set(position.nftId, { chainId, positionId: position.positionId });

      // Start the new batch
      await newBatch.start();
      log.info({ chainId, nftId: position.nftId, batchIndex, msg: 'Created new batch for position' });
    }
  }

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
  // Domain Event Handlers
  // ===========================================================================

  /**
   * Handle position.created domain event.
   * Adds the position to WebSocket subscriptions if it's a UniswapV3 position.
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

    // 6. Add to subscription
    const positionInfo: PositionInfo = {
      nftId,
      positionId: payload.id,
    };

    log.info({ chainId, nftId, positionId: payload.id }, 'Adding position from created event');
    await this.addPositionToBatch(chainId, wssUrl, positionInfo);
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
}
