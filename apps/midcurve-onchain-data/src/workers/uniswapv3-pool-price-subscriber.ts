/**
 * UniswapV3PoolPriceSubscriber Worker
 *
 * Manages WebSocket subscriptions for Uniswap V3 pool price (Swap) events.
 * Polls the database for active subscriptions and manages their lifecycle:
 * - active: subscribed to WebSocket events
 * - paused: removed from WebSocket after 60s without polling
 * - deleted: cleaned up after 5min in paused state
 *
 * API endpoint handles reactivation when a paused subscription is polled.
 */

import { prisma } from '@midcurve/database';
import { onchainDataLogger, priceLog } from '../lib/logger.js';
import {
  getConfiguredWssUrls,
  getWssUrl,
  getWorkerConfig,
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config.js';
import {
  UniswapV3PoolPriceSubscriptionBatch,
  createPoolPriceSubscriptionBatches,
  type PoolPriceInfo,
} from '../ws/providers/uniswapv3-pool-price.js';
import type { UniswapV3PoolPriceSubscriptionConfig } from '@midcurve/shared';

const log = onchainDataLogger.child({ component: 'UniswapV3PoolPriceSubscriber' });

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.POOL_PRICE_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.POOL_PRICE_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for checking stale subscriptions (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.POOL_PRICE_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling new subscriptions (default: 5 seconds) */
const POLL_INTERVAL_MS = parseInt(process.env.POOL_PRICE_POLL_INTERVAL_MS || '5000', 10);

/**
 * UniswapV3PoolPriceSubscriber manages WebSocket subscriptions for Swap events.
 * Subscriptions are created via the API and managed by this worker.
 */
export class UniswapV3PoolPriceSubscriber {
  private batches: UniswapV3PoolPriceSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, UniswapV3PoolPriceSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Track subscribed pools by subscriptionId
  private subscribedPools: Map<string, PoolPriceInfo & { chainId: SupportedChainId }> = new Map();

  // Timers
  private cleanupTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads active subscriptions and creates WebSocket batches.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'starting');

    try {
      // Load active subscriptions from database
      const poolsByChain = await this.loadActiveSubscriptions();

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
        const pools = poolsByChain.get(chainId);

        if (!pools || pools.length === 0) {
          log.info({ chainId, msg: 'No active pool price subscriptions for chain, skipping' });
          continue;
        }

        const chainBatches = createPoolPriceSubscriptionBatches(chainId, wssConfig.url, pools);
        this.batches.push(...chainBatches);
        this.batchesByChain.set(chainId, chainBatches);
      }

      this.isRunning = true;

      if (this.batches.length === 0) {
        log.info({
          msg: 'No subscription batches created, subscriber will idle until new subscriptions are added',
        });
      } else {
        // Start all batches
        await Promise.all(this.batches.map((batch) => batch.start()));
      }

      // Start cleanup timer (pause stale, prune deleted)
      this.startCleanup();

      // Start polling for new subscriptions
      this.startPolling();

      const totalPools = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().poolCount,
        0
      );

      priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'started', {
        batchCount: this.batches.length,
        totalPools,
      });
    } catch (error) {
      priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'error', {
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

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'stopping');

    // Stop timers
    this.stopCleanup();
    this.stopPolling();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.subscribedPools.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    batchCount: number;
    totalSubscriptions: number;
    batches: Array<{
      chainId: number;
      batchIndex: number;
      poolCount: number;
      isConnected: boolean;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      batchCount: this.batches.length,
      totalSubscriptions: this.subscribedPools.size,
      batches: this.batches.map((batch) => batch.getStatus()),
    };
  }

  /**
   * Load active subscriptions from database.
   * Groups by chain ID for batch creation.
   */
  private async loadActiveSubscriptions(): Promise<Map<SupportedChainId, PoolPriceInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    // Query active uniswapv3-pool-price subscriptions
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    log.info({
      subscriptionCount: subscriptions.length,
      msg: 'Loaded active pool price subscriptions',
    });

    // Group by chain ID
    const poolsByChain = new Map<SupportedChainId, PoolPriceInfo[]>();

    for (const sub of subscriptions) {
      const config = sub.config as unknown as UniswapV3PoolPriceSubscriptionConfig;

      if (!config.chainId || !config.poolAddress) {
        log.warn({
          subscriptionId: sub.subscriptionId,
          msg: 'Subscription config missing chainId or poolAddress',
        });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({
          chainId: config.chainId,
          subscriptionId: sub.subscriptionId,
          msg: 'Unsupported chain ID',
        });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;
      const normalizedPool = config.poolAddress.toLowerCase();

      const poolInfo: PoolPriceInfo = {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        poolAddress: normalizedPool,
      };

      // Track in internal state
      this.subscribedPools.set(sub.subscriptionId, {
        ...poolInfo,
        chainId,
      });

      // Add to chain grouping
      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }

      poolsByChain.get(chainId)!.push(poolInfo);
    }

    // Log summary
    for (const [chainId, chainPools] of poolsByChain) {
      log.info({ chainId, poolCount: chainPools.length, msg: 'Pools grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');

    return poolsByChain;
  }

  // ===========================================================================
  // Subscription Lifecycle Management
  // ===========================================================================

  /**
   * Add a pool subscription to the worker.
   * Called when API creates a new subscription or reactivates a paused one.
   */
  async addPool(
    subscriptionId: string,
    id: string,
    chainId: number,
    poolAddress: string
  ): Promise<void> {
    // Validate chain
    if (!isSupportedChain(chainId)) {
      log.warn({ chainId, subscriptionId, msg: 'Unsupported chain ID, cannot add pool' });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;

    // Check if already subscribed
    if (this.subscribedPools.has(subscriptionId)) {
      log.debug({ subscriptionId, msg: 'Pool already subscribed' });
      return;
    }

    // Get WSS URL
    const wssUrl = getWssUrl(supportedChainId);
    if (!wssUrl) {
      log.warn({ chainId, subscriptionId, msg: 'No WSS URL configured for chain' });
      return;
    }

    const poolInfo: PoolPriceInfo = {
      id,
      subscriptionId,
      poolAddress: poolAddress.toLowerCase(),
    };

    // Track
    this.subscribedPools.set(subscriptionId, {
      ...poolInfo,
      chainId: supportedChainId,
    });

    // Add to batch
    await this.addPoolToBatch(supportedChainId, wssUrl, poolInfo);

    log.info({
      chainId,
      subscriptionId,
      poolAddress: poolInfo.poolAddress,
      msg: 'Added pool subscription',
    });
  }

  /**
   * Remove a pool subscription from the worker.
   * Called when subscription is paused or deleted.
   */
  async removePool(subscriptionId: string): Promise<void> {
    const poolInfo = this.subscribedPools.get(subscriptionId);
    if (!poolInfo) {
      log.debug({ subscriptionId, msg: 'Pool not found in subscribed list' });
      return;
    }

    // Remove from internal tracking
    this.subscribedPools.delete(subscriptionId);

    // Remove from batch
    const chainBatches = this.batchesByChain.get(poolInfo.chainId);
    if (chainBatches) {
      for (const batch of chainBatches) {
        if (batch.hasPool(subscriptionId)) {
          await batch.removePool(subscriptionId);
          break;
        }
      }
    }

    log.info({
      chainId: poolInfo.chainId,
      subscriptionId,
      msg: 'Removed pool subscription',
    });
  }

  /**
   * Add a pool to an existing batch or create a new batch if needed.
   */
  private async addPoolToBatch(
    chainId: SupportedChainId,
    wssUrl: string,
    pool: PoolPriceInfo
  ): Promise<void> {
    const config = getWorkerConfig();
    let chainBatches = this.batchesByChain.get(chainId);

    if (!chainBatches) {
      chainBatches = [];
      this.batchesByChain.set(chainId, chainBatches);
    }

    // Find a batch with room
    let targetBatch = chainBatches.find(
      (batch) => batch.getStatus().poolCount < config.maxPoolsPerConnection
    );

    if (targetBatch) {
      // Add to existing batch
      await targetBatch.addPool(pool);
      log.info({
        chainId,
        subscriptionId: pool.subscriptionId,
        batchIndex: targetBatch.getStatus().batchIndex,
        msg: 'Added pool to existing batch',
      });
    } else {
      // Create new batch
      const batchIndex = chainBatches.length;
      const newBatch = new UniswapV3PoolPriceSubscriptionBatch(chainId, wssUrl, batchIndex, [pool]);
      chainBatches.push(newBatch);
      this.batches.push(newBatch);

      // Start the new batch
      await newBatch.start();
      log.info({
        chainId,
        subscriptionId: pool.subscriptionId,
        batchIndex,
        msg: 'Created new batch for pool',
      });
    }
  }

  // ===========================================================================
  // Polling (for new subscriptions and reactivations)
  // ===========================================================================

  /**
   * Start polling for new subscriptions.
   */
  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.pollNewSubscriptions().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling for new subscriptions',
        });
      });
    }, POLL_INTERVAL_MS);

    log.info({ intervalMs: POLL_INTERVAL_MS, msg: 'Started polling for new subscriptions' });
  }

  /**
   * Stop polling.
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      log.info({ msg: 'Stopped polling for new subscriptions' });
    }
  }

  /**
   * Poll database for new active subscriptions that aren't tracked yet.
   */
  private async pollNewSubscriptions(): Promise<void> {
    // Get all active subscriptions we're NOT yet tracking
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedPools.keys()),
        },
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    log.info({ count: subscriptions.length, msg: 'Found new active subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as UniswapV3PoolPriceSubscriptionConfig;

      if (!isSupportedChain(config.chainId)) {
        log.warn({
          chainId: config.chainId,
          subscriptionId: sub.subscriptionId,
          msg: 'Unsupported chain ID, skipping',
        });
        continue;
      }

      await this.addPool(sub.subscriptionId, sub.id, config.chainId, config.poolAddress);
    }
  }

  // ===========================================================================
  // Cleanup (pause stale, prune deleted)
  // ===========================================================================

  /**
   * Start the cleanup timer.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      Promise.all([this.pauseStaleSubscriptions(), this.pruneDeletedSubscriptions()]).catch(
        (err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            msg: 'Error during cleanup',
          });
        }
      );
    }, CLEANUP_INTERVAL_MS);

    log.info({
      intervalMs: CLEANUP_INTERVAL_MS,
      pauseThresholdMs: PAUSE_THRESHOLD_MS,
      pruneThresholdMs: PRUNE_THRESHOLD_MS,
      msg: 'Started cleanup timer',
    });
  }

  /**
   * Stop the cleanup timer.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped cleanup timer' });
    }
  }

  /**
   * Pause subscriptions that haven't been polled in PAUSE_THRESHOLD_MS.
   * Removes them from WebSocket but keeps the DB record.
   */
  private async pauseStaleSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - PAUSE_THRESHOLD_MS);

    // Find active subscriptions with stale lastPolledAt
    const staleSubscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        status: 'active',
        lastPolledAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        subscriptionId: true,
      },
    });

    if (staleSubscriptions.length === 0) {
      return;
    }

    log.info({ count: staleSubscriptions.length, msg: 'Pausing stale subscriptions' });

    const now = new Date();

    for (const sub of staleSubscriptions) {
      // Update database status to paused
      await prisma.onchainDataSubscribers.update({
        where: { id: sub.id },
        data: {
          status: 'paused',
          pausedAt: now,
        },
      });

      // Remove from WebSocket batch
      await this.removePool(sub.subscriptionId);

      log.info({ subscriptionId: sub.subscriptionId, msg: 'Paused stale subscription' });
    }
  }

  /**
   * Delete subscriptions that have been paused for longer than PRUNE_THRESHOLD_MS.
   */
  private async pruneDeletedSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - PRUNE_THRESHOLD_MS);

    // Find paused subscriptions that have been paused for too long
    const toDelete = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        status: 'paused',
        pausedAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        subscriptionId: true,
      },
    });

    if (toDelete.length === 0) {
      return;
    }

    log.info({ count: toDelete.length, msg: 'Pruning old paused subscriptions' });

    // Delete from database
    const subscriptionIds = toDelete.map((sub) => sub.subscriptionId);

    await prisma.onchainDataSubscribers.deleteMany({
      where: {
        subscriptionId: { in: subscriptionIds },
      },
    });

    log.info({ count: toDelete.length, msg: 'Pruned paused subscriptions' });
  }
}
