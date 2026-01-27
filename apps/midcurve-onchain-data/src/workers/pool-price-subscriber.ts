/**
 * PoolPriceSubscriber Worker
 *
 * Subscribes to Swap events for pools that have active positions.
 * Dynamically adds/removes pools based on position lifecycle events.
 * Publishes incoming Swap events to RabbitMQ.
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
  UniswapV3PoolSubscriptionBatch,
  createSubscriptionBatches,
  type PoolInfo,
} from '../ws/providers/uniswap-v3-pools';

const log = onchainDataLogger.child({ component: 'PoolPriceSubscriber' });

/**
 * Pool configuration from database JSON field.
 */
interface PoolConfig {
  chainId: number;
  address: string;
}

/**
 * Position configuration from database JSON field.
 */
interface PositionConfig {
  chainId: number;
  nftId: number;
  poolAddress: string;
}

/**
 * Tracks a subscribed pool with its metadata.
 */
interface SubscribedPool {
  poolId: string;
  poolAddress: string;
  chainId: SupportedChainId;
}

/**
 * PoolPriceSubscriber manages WebSocket subscriptions for pool prices.
 * Subscriptions are derived from active positions - pools are subscribed
 * when they have at least one active position.
 */
export class PoolPriceSubscriber {
  private batches: UniswapV3PoolSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, UniswapV3PoolSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Track subscribed pools by address (lowercase)
  private subscribedPools: Map<string, SubscribedPool> = new Map();

  // Cleanup state
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads pools with active positions and creates WebSocket batches.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'PoolPriceSubscriber', 'starting');

    try {
      // Load pools with active positions from database
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
          log.info({ chainId, msg: 'No pools with active positions for chain, skipping' });
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

      // Start cleanup timer (safety net for missed events)
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

    // Stop cleanup timer
    this.stopCleanup();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.subscribedPools.clear();
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
   * Load pools that have at least one active UniswapV3 position.
   * Groups by chain ID for batch creation.
   */
  private async loadActiveSubscriptions(): Promise<Map<SupportedChainId, PoolInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    // Query pools that have at least one active UniswapV3 position
    const pools = await prisma.pool.findMany({
      where: {
        protocol: 'uniswapv3',
        positions: {
          some: {
            isActive: true,
            protocol: 'uniswapv3',
          },
        },
      },
      select: {
        id: true,
        config: true,
      },
    });

    log.info({ poolCount: pools.length, msg: 'Loaded pools with active positions' });

    // Group pools by chain ID
    const poolsByChain = new Map<SupportedChainId, PoolInfo[]>();

    for (const pool of pools) {
      const config = pool.config as unknown as PoolConfig;

      if (!config.chainId || !config.address) {
        log.warn({ poolId: pool.id, msg: 'Pool config missing chainId or address' });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, poolId: pool.id, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;
      const normalizedAddress = config.address.toLowerCase();

      // Track in internal state
      this.subscribedPools.set(normalizedAddress, {
        poolId: pool.id,
        poolAddress: normalizedAddress,
        chainId,
      });

      // Add to chain grouping
      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }

      poolsByChain.get(chainId)!.push({
        address: normalizedAddress,
        poolId: pool.id,
      });
    }

    // Log summary
    for (const [chainId, chainPools] of poolsByChain) {
      log.info({ chainId, poolCount: chainPools.length, msg: 'Pools grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');

    return poolsByChain;
  }

  // ===========================================================================
  // Domain Event Handlers
  // ===========================================================================

  /**
   * Handle position.created domain event.
   * Adds the pool to WebSocket subscriptions if not already subscribed.
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
    if (!config.chainId || !config.poolAddress) {
      log.warn({ positionId: payload.id }, 'Position config missing chainId or poolAddress');
      return;
    }

    // 3. Validate chain support
    if (!isSupportedChain(config.chainId)) {
      log.debug({ chainId: config.chainId, positionId: payload.id }, 'Unsupported chain, ignoring');
      return;
    }

    const chainId = config.chainId as SupportedChainId;
    const normalizedAddress = config.poolAddress.toLowerCase();

    // 4. Skip if pool already subscribed (idempotency)
    if (this.subscribedPools.has(normalizedAddress)) {
      log.debug({ poolAddress: normalizedAddress, positionId: payload.id }, 'Pool already subscribed, skipping');
      return;
    }

    // 5. Get WSS URL for chain
    const wssUrl = getWssUrl(chainId);
    if (!wssUrl) {
      log.warn({ chainId, positionId: payload.id }, 'No WSS URL configured for chain');
      return;
    }

    // 6. Look up pool ID from database (position.poolId or find by address)
    const position = await prisma.position.findUnique({
      where: { id: payload.id },
      select: { poolId: true },
    });

    const poolId = position?.poolId ?? `pool-${chainId}-${normalizedAddress}`;

    // 7. Track and add to subscription
    this.subscribedPools.set(normalizedAddress, {
      poolId,
      poolAddress: normalizedAddress,
      chainId,
    });

    const poolInfo: PoolInfo = {
      address: normalizedAddress,
      poolId,
    };

    log.info({ chainId, poolAddress: normalizedAddress, positionId: payload.id }, 'Adding pool from position.created event');
    await this.addPoolToBatch(chainId, wssUrl, poolInfo);
  }

  /**
   * Handle position.closed domain event.
   * Removes the pool from subscriptions if no other active positions use it.
   *
   * @param chainId - Chain ID from routing key
   * @param nftId - NFT ID from routing key
   */
  async handlePositionClosed(chainId: number, nftId: string): Promise<void> {
    await this.handlePositionRemoved(chainId, nftId, 'closed');
  }

  /**
   * Handle position.deleted domain event.
   * Removes the pool from subscriptions if no other active positions use it.
   *
   * @param chainId - Chain ID from routing key
   * @param nftId - NFT ID from routing key
   */
  async handlePositionDeleted(chainId: number, nftId: string): Promise<void> {
    await this.handlePositionRemoved(chainId, nftId, 'deleted');
  }

  /**
   * Private helper for position removal (closed or deleted).
   * Checks if any other active positions use the same pool before unsubscribing.
   */
  private async handlePositionRemoved(
    chainId: number,
    nftId: string,
    reason: 'closed' | 'deleted'
  ): Promise<void> {
    // 1. Validate chain support
    if (!isSupportedChain(chainId)) {
      log.debug({ chainId, nftId }, 'Unsupported chain, ignoring');
      return;
    }

    // 2. Find the position by positionHash to get its poolId
    const positionHash = `uniswapv3/${chainId}/${nftId}`;
    const position = await prisma.position.findFirst({
      where: {
        positionHash,
        protocol: 'uniswapv3',
      },
      select: {
        id: true,
        poolId: true,
        pool: {
          select: {
            config: true,
          },
        },
      },
    });

    if (!position) {
      log.debug({ chainId, nftId, reason }, 'Position not found in database');
      return;
    }

    // 3. Get pool address
    const poolConfig = position.pool.config as unknown as PoolConfig;
    const poolAddress = poolConfig.address?.toLowerCase();

    if (!poolAddress) {
      log.warn({ positionId: position.id, reason }, 'Pool address not found');
      return;
    }

    // 4. Check if pool is tracked
    if (!this.subscribedPools.has(poolAddress)) {
      log.debug({ poolAddress, reason }, 'Pool not subscribed, skipping');
      return;
    }

    // 5. Check if other active positions still use this pool
    const otherActivePositions = await prisma.position.count({
      where: {
        poolId: position.poolId,
        isActive: true,
        protocol: 'uniswapv3',
        id: { not: position.id },
      },
    });

    if (otherActivePositions > 0) {
      log.debug(
        { poolAddress, otherActivePositions, reason },
        'Pool still has other active positions, keeping subscription'
      );
      return;
    }

    // 6. No other active positions - unsubscribe from pool
    log.info(
      { poolId: position.poolId, poolAddress, chainId, reason },
      'Pool has no more active positions, removing subscription'
    );

    const poolSub = this.subscribedPools.get(poolAddress);
    this.subscribedPools.delete(poolAddress);

    // 7. Remove from WebSocket batch
    if (poolSub) {
      const chainBatches = this.batchesByChain.get(poolSub.chainId);
      if (chainBatches) {
        for (const batch of chainBatches) {
          if (batch.hasPool(poolAddress)) {
            await batch.removePool(poolAddress);
            break;
          }
        }
      }
    }
  }

  // ===========================================================================
  // Pool Batch Management
  // ===========================================================================

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
      const newBatch = new UniswapV3PoolSubscriptionBatch(chainId, wssUrl, batchIndex, [pool]);
      chainBatches.push(newBatch);
      this.batches.push(newBatch);

      // Start the new batch
      await newBatch.start();
      log.info({ chainId, poolAddress: pool.address, batchIndex, msg: 'Created new batch for pool' });
    }
  }

  // ===========================================================================
  // Cleanup (safety net for missed events)
  // ===========================================================================

  /**
   * Start the cleanup timer for orphaned pools.
   */
  private startCleanup(): void {
    const config = getWorkerConfig();

    this.cleanupTimer = setInterval(() => {
      this.cleanupOrphanedPools().catch((err) => {
        log.error({ error: err instanceof Error ? err.message : String(err), msg: 'Error cleaning up orphaned pools' });
      });
    }, config.cleanupIntervalMs);

    log.info({ intervalMs: config.cleanupIntervalMs, msg: 'Started orphaned pool cleanup' });
  }

  /**
   * Stop the cleanup timer.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped orphaned pool cleanup' });
    }
  }

  /**
   * Clean up pools that no longer have active positions.
   * Safety net in case domain events were missed.
   */
  private async cleanupOrphanedPools(): Promise<void> {
    if (this.subscribedPools.size === 0) {
      return;
    }

    // Get all currently subscribed pool IDs
    const subscribedPoolIds = Array.from(this.subscribedPools.values()).map((p) => p.poolId);

    // Query which of these pools still have active positions
    const poolsWithActivePositions = await prisma.pool.findMany({
      where: {
        id: { in: subscribedPoolIds },
        positions: {
          some: {
            isActive: true,
            protocol: 'uniswapv3',
          },
        },
      },
      select: { id: true },
    });

    const activePoolIds = new Set(poolsWithActivePositions.map((p) => p.id));

    // Find pools that are subscribed but have no active positions
    const orphanedPools: SubscribedPool[] = [];
    for (const poolSub of this.subscribedPools.values()) {
      if (!activePoolIds.has(poolSub.poolId)) {
        orphanedPools.push(poolSub);
      }
    }

    if (orphanedPools.length === 0) {
      return;
    }

    log.info({ count: orphanedPools.length, msg: 'Found orphaned pools to remove from subscriptions' });

    // Remove orphaned pools
    for (const poolSub of orphanedPools) {
      this.subscribedPools.delete(poolSub.poolAddress);

      // Remove from WebSocket batch
      const chainBatches = this.batchesByChain.get(poolSub.chainId);
      if (chainBatches) {
        for (const batch of chainBatches) {
          if (batch.hasPool(poolSub.poolAddress)) {
            await batch.removePool(poolSub.poolAddress);
            log.info({
              poolId: poolSub.poolId,
              poolAddress: poolSub.poolAddress,
              chainId: poolSub.chainId,
              msg: 'Removed orphaned pool from subscription',
            });
            break;
          }
        }
      }
    }
  }
}
