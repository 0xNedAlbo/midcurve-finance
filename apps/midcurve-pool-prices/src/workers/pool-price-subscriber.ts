/**
 * PoolPriceSubscriber Worker
 *
 * Loads active subscriptions from database, creates WebSocket subscription batches,
 * and manages their lifecycle. Publishes incoming Swap events to RabbitMQ.
 */

import { prisma } from '@midcurve/database';
import { poolPricesLogger, priceLog } from '../lib/logger';
import {
  getConfiguredWssUrls,
  getWorkerConfig,
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config';
import {
  UniswapV3SubscriptionBatch,
  createSubscriptionBatches,
  type PoolInfo,
} from '../ws/providers/uniswap-v3';

const log = poolPricesLogger.child({ component: 'PoolPriceSubscriber' });

/**
 * Pool configuration from database JSON field.
 */
interface PoolConfig {
  chainId: number;
  address: string;
}

/**
 * PoolPriceSubscriber manages WebSocket subscriptions for pool prices.
 */
export class PoolPriceSubscriber {
  private batches: UniswapV3SubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, UniswapV3SubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Polling state
  private lastPollTimestamp: Date = new Date();
  private pollTimer: NodeJS.Timeout | null = null;

  // Cleanup state
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads active subscriptions and creates WebSocket batches.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'PoolPriceSubscriber', 'starting');

    try {
      // Load active subscriptions from database
      const poolsByChain = await this.loadActiveSubscriptions();

      // Get configured WSS URLs
      const wssConfigs = getConfiguredWssUrls();

      if (wssConfigs.length === 0) {
        log.warn({ msg: 'No WS_RPC_URL_* environment variables configured, subscriber will not start. Set WS_RPC_URL_ETHEREUM, WS_RPC_URL_ARBITRUM, etc.' });
        return;
      }

      // Create subscription batches for each configured chain
      for (const wssConfig of wssConfigs) {
        const chainId = wssConfig.chainId as SupportedChainId;
        const pools = poolsByChain.get(chainId);

        if (!pools || pools.length === 0) {
          log.info({ chainId, msg: 'No active subscriptions for chain, skipping' });
          continue;
        }

        const chainBatches = createSubscriptionBatches(chainId, wssConfig.url, pools);
        this.batches.push(...chainBatches);
        this.batchesByChain.set(chainId, chainBatches);
      }

      this.isRunning = true;

      if (this.batches.length === 0) {
        log.warn({ msg: 'No subscription batches created, subscriber will idle' });
      } else {
        // Start all batches
        await Promise.all(this.batches.map((batch) => batch.start()));
      }

      // Start polling and cleanup timers (even if no batches, for dynamic subscriptions)
      this.startPolling();
      this.startCleanup();

      const totalPools = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().poolCount,
        0
      );

      priceLog.workerLifecycle(log, 'PoolPriceSubscriber', 'started', {
        batchCount: this.batches.length,
        totalPools,
      });
    } catch (error) {
      priceLog.workerLifecycle(log, 'PoolPriceSubscriber', 'error', {
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

    priceLog.workerLifecycle(log, 'PoolPriceSubscriber', 'stopping');

    // Stop timers
    this.stopPolling();
    this.stopCleanup();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'PoolPriceSubscriber', 'stopped');
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
      poolCount: number;
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
   * Load active subscriptions from database, grouped by chain ID.
   */
  private async loadActiveSubscriptions(): Promise<Map<SupportedChainId, PoolInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    // Query active subscriptions with pool info
    const subscriptions = await prisma.poolPriceSubscribers.findMany({
      where: {
        isActive: true,
      },
      include: {
        pool: {
          select: {
            id: true,
            config: true,
            protocol: true,
          },
        },
      },
    });

    log.info({ subscriptionCount: subscriptions.length, msg: 'Loaded active subscriptions' });

    // Group pools by chain ID
    const poolsByChain = new Map<SupportedChainId, PoolInfo[]>();

    for (const sub of subscriptions) {
      // Only handle UniswapV3 pools for now
      if (sub.pool.protocol !== 'uniswapv3') {
        log.debug({ protocol: sub.pool.protocol, poolId: sub.pool.id, msg: 'Skipping non-UniswapV3 pool' });
        continue;
      }

      const config = sub.pool.config as unknown as PoolConfig;

      if (!config.chainId || !config.address) {
        log.warn({ poolId: sub.pool.id, msg: 'Pool config missing chainId or address' });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, poolId: sub.pool.id, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;

      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }

      poolsByChain.get(chainId)!.push({
        address: config.address,
        poolId: sub.pool.id,
      });
    }

    // Log summary
    for (const [chainId, pools] of poolsByChain) {
      log.info({ chainId, poolCount: pools.length, msg: 'Pools grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');

    return poolsByChain;
  }

  // ===========================================================================
  // Polling for new subscriptions
  // ===========================================================================

  /**
   * Start the polling timer for new subscriptions.
   */
  private startPolling(): void {
    const config = getWorkerConfig();
    this.lastPollTimestamp = new Date();

    this.pollTimer = setInterval(() => {
      this.pollNewSubscriptions().catch((err) => {
        log.error({ error: err instanceof Error ? err.message : String(err), msg: 'Error polling new subscriptions' });
      });
    }, config.pollIntervalMs);

    log.info({ intervalMs: config.pollIntervalMs, msg: 'Started subscription polling' });
  }

  /**
   * Stop the polling timer.
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      log.info({ msg: 'Stopped subscription polling' });
    }
  }

  /**
   * Poll for new or reactivated subscriptions since last poll.
   * Uses updatedAt to catch both newly created and reactivated subscribers.
   */
  private async pollNewSubscriptions(): Promise<void> {
    const newSubs = await prisma.poolPriceSubscribers.findMany({
      where: {
        isActive: true,
        updatedAt: { gt: this.lastPollTimestamp },
      },
      include: {
        pool: {
          select: {
            id: true,
            config: true,
            protocol: true,
          },
        },
      },
    });

    this.lastPollTimestamp = new Date();

    if (newSubs.length === 0) {
      return;
    }

    log.info({ count: newSubs.length, msg: 'Found new subscriptions' });

    // Group new subscriptions by chain
    const wssConfigs = getConfiguredWssUrls();
    const wssUrlByChain = new Map(wssConfigs.map((c) => [c.chainId as SupportedChainId, c.url]));

    for (const sub of newSubs) {
      if (sub.pool.protocol !== 'uniswapv3') {
        continue;
      }

      const config = sub.pool.config as unknown as PoolConfig;
      if (!config.chainId || !config.address || !isSupportedChain(config.chainId)) {
        continue;
      }

      const chainId = config.chainId as SupportedChainId;
      const wssUrl = wssUrlByChain.get(chainId);

      if (!wssUrl) {
        log.warn({ chainId, msg: 'No WSS URL configured for chain, skipping new subscription' });
        continue;
      }

      const poolInfo: PoolInfo = {
        address: config.address,
        poolId: sub.pool.id,
      };

      // Add to existing batch or create new one
      await this.addPoolToBatch(chainId, wssUrl, poolInfo);
    }
  }

  /**
   * Add a pool to an existing batch or create a new batch if needed.
   */
  private async addPoolToBatch(chainId: SupportedChainId, wssUrl: string, pool: PoolInfo): Promise<void> {
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
      log.info({ chainId, poolAddress: pool.address, batchIndex: targetBatch.getStatus().batchIndex, msg: 'Added pool to existing batch' });
    } else {
      // Create new batch
      const batchIndex = chainBatches.length;
      const newBatch = new UniswapV3SubscriptionBatch(chainId, wssUrl, batchIndex, [pool]);
      chainBatches.push(newBatch);
      this.batches.push(newBatch);

      // Start the new batch
      await newBatch.start();
      log.info({ chainId, poolAddress: pool.address, batchIndex, msg: 'Created new batch for pool' });
    }
  }

  // ===========================================================================
  // Cleanup stale subscribers
  // ===========================================================================

  /**
   * Start the cleanup timer for stale subscribers.
   */
  private startCleanup(): void {
    const config = getWorkerConfig();

    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSubscribers().catch((err) => {
        log.error({ error: err instanceof Error ? err.message : String(err), msg: 'Error cleaning up stale subscribers' });
      });
    }, config.cleanupIntervalMs);

    log.info({ intervalMs: config.cleanupIntervalMs, msg: 'Started stale subscriber cleanup' });
  }

  /**
   * Stop the cleanup timer.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped stale subscriber cleanup' });
    }
  }

  /**
   * Clean up stale subscribers and remove orphaned pools.
   *
   * This method does two things:
   * 1. Marks stale subscribers as inactive (lastAliveAt behind current time by threshold)
   * 2. Removes pools with no active subscribers from WebSocket subscriptions
   *
   * The second step handles both:
   * - Pools that became orphaned due to stale cleanup
   * - Pools where subscribers manually set isActive=false (active unsubscription)
   */
  private async cleanupStaleSubscribers(): Promise<void> {
    const config = getWorkerConfig();
    const staleThreshold = new Date(Date.now() - config.staleThresholdMs);

    // Find subscribers whose lastAliveAt is behind current time by threshold
    const staleSubscribers = await prisma.poolPriceSubscribers.findMany({
      where: {
        isActive: true,
        lastAliveAt: {
          not: null,
          lt: staleThreshold, // lastAliveAt < (now - threshold)
        },
      },
      select: { id: true, poolId: true },
    });

    if (staleSubscribers.length > 0) {
      log.info({ count: staleSubscribers.length, msg: 'Marking stale subscribers as inactive' });

      // Mark as inactive (soft delete)
      await prisma.poolPriceSubscribers.updateMany({
        where: { id: { in: staleSubscribers.map((s) => s.id) } },
        data: { isActive: false },
      });
    }

    // Check all subscribed pools for orphans (handles both stale cleanup and manual unsubscription)
    await this.removeOrphanedPoolsFromAllBatches();
  }

  /**
   * Remove pools with no active subscribers from all WebSocket subscription batches.
   *
   * This checks all currently subscribed pools and removes any that have no active
   * subscribers in the database. Handles both:
   * - Pools orphaned by stale cleanup
   * - Pools where subscribers manually set isActive=false
   */
  private async removeOrphanedPoolsFromAllBatches(): Promise<void> {
    // Collect all poolIds currently subscribed across all batches
    const subscribedPoolIds: string[] = [];
    for (const chainBatches of this.batchesByChain.values()) {
      for (const batch of chainBatches) {
        const status = batch.getStatus();
        if (status.poolCount > 0) {
          // Get pool IDs from our internal tracking
          // We need to look up poolIds by address from the batch
          const poolAddresses = batch.getPoolAddresses();
          for (const address of poolAddresses) {
            const poolInfo = batch.getPoolInfo(address);
            if (poolInfo) {
              subscribedPoolIds.push(poolInfo.poolId);
            }
          }
        }
      }
    }

    if (subscribedPoolIds.length === 0) return;

    // Find which of these pools have at least one active subscriber
    const poolsWithSubscribers = await prisma.poolPriceSubscribers.groupBy({
      by: ['poolId'],
      where: {
        poolId: { in: subscribedPoolIds },
        isActive: true,
      },
      _count: true,
    });

    const poolsWithActiveSubscribers = new Set(poolsWithSubscribers.map((p) => p.poolId));
    const orphanedPoolIds = subscribedPoolIds.filter((id) => !poolsWithActiveSubscribers.has(id));

    if (orphanedPoolIds.length === 0) return;

    log.info({ count: orphanedPoolIds.length, msg: 'Found orphaned pools to remove from subscriptions' });

    // Get pool addresses from database
    const orphanedPools = await prisma.pool.findMany({
      where: { id: { in: orphanedPoolIds } },
      select: { id: true, config: true },
    });

    for (const pool of orphanedPools) {
      const config = pool.config as { chainId?: number; address?: string };
      if (!config.chainId || !config.address) continue;

      if (!isSupportedChain(config.chainId)) continue;

      const chainId = config.chainId as SupportedChainId;

      // Find and remove from batch
      const chainBatches = this.batchesByChain.get(chainId);
      if (!chainBatches) continue;

      for (const batch of chainBatches) {
        if (batch.hasPool(config.address)) {
          await batch.removePool(config.address);
          log.info({
            poolId: pool.id,
            poolAddress: config.address,
            chainId,
            msg: 'Removed orphaned pool from subscription',
          });
          break;
        }
      }
    }
  }
}
