/**
 * PoolPriceSubscriber Worker
 *
 * Monitors pool prices for pools that have active positions.
 * Dynamically adds/removes pools based on position lifecycle events.
 * Publishes price changes to RabbitMQ via slot0() polling.
 */

import { prisma } from '@midcurve/database';
// PositionJSON import removed — handlePositionCreated now uses DB lookup
import { getEvmConfig } from '@midcurve/services';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import {
  getWorkerConfig,
  isSupportedChain,
  SUPPORTED_CHAIN_IDS,
} from '../../lib/config';
import {
  UniswapV3PoolSubscriptionBatch,
  createSubscriptionBatches,
  type PoolInfo,
} from '../../polling/uniswap-v3-pools';

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
  chainId: number;
}

/**
 * PoolPriceSubscriber manages pool price polling batches.
 * Subscriptions are derived from active positions - pools are polled
 * when they have at least one active position.
 */
export class PoolPriceSubscriber {
  private batches: UniswapV3PoolSubscriptionBatch[] = [];
  private batchesByChain: Map<number, UniswapV3PoolSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Track subscribed pools by address (lowercase)
  private subscribedPools: Map<string, SubscribedPool> = new Map();

  // Cleanup state
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads pools with active positions and creates polling batches.
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

      // Discover which chains have HTTP RPC configured
      const evmConfig = getEvmConfig();
      const configuredChains: number[] = [];
      for (const chainId of SUPPORTED_CHAIN_IDS) {
        try {
          evmConfig.getPublicClient(chainId);
          configuredChains.push(chainId);
        } catch {
          log.debug({ chainId, msg: 'Chain not configured, skipping' });
        }
      }

      if (configuredChains.length === 0) {
        log.warn({ msg: 'No RPC_URL_* environment variables configured, subscriber will not start' });
        return;
      }

      // Create polling batches for each configured chain
      for (const chainId of configuredChains) {
        const pools = poolsByChain.get(chainId);

        if (!pools || pools.length === 0) {
          log.info({ chainId, msg: 'No pools with active positions for chain, skipping' });
          continue;
        }

        const chainBatches = createSubscriptionBatches(chainId, pools);
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
   * Stops all polling batches gracefully.
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
  private async loadActiveSubscriptions(): Promise<Map<number, PoolInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    // Query active positions and deduplicate by pool address
    // Includes both NFT and vault positions — they share the same UniswapV3 pools
    const activePositions = await prisma.position.findMany({
      where: {
        isActive: true,
        protocol: { in: ['uniswapv3', 'uniswapv3-vault'] },
      },
      select: {
        config: true,
      },
    });

    // Deduplicate by poolAddress (multiple positions can share a pool)
    const uniquePools = new Map<string, PoolConfig>();
    for (const pos of activePositions) {
      const config = pos.config as unknown as { chainId: number; poolAddress: string };
      if (!config.chainId || !config.poolAddress) continue;
      const key = `${config.chainId}/${config.poolAddress.toLowerCase()}`;
      if (!uniquePools.has(key)) {
        uniquePools.set(key, { chainId: config.chainId, address: config.poolAddress });
      }
    }

    log.info({ poolCount: uniquePools.size, msg: 'Loaded pools with active positions' });

    // Group pools by chain ID
    const poolsByChain = new Map<number, PoolInfo[]>();

    for (const [, config] of uniquePools) {
      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId;
      const normalizedAddress = config.address.toLowerCase();
      const poolId = `uniswapv3/${chainId}/${normalizedAddress}`;

      // Track in internal state
      this.subscribedPools.set(normalizedAddress, {
        poolId,
        poolAddress: normalizedAddress,
        chainId,
      });

      // Add to chain grouping
      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }

      poolsByChain.get(chainId)!.push({
        address: normalizedAddress,
        poolId,
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
   * Adds the pool to polling if not already subscribed.
   *
   * @param positionId - Database position ID from the domain event
   */
  async handlePositionCreated(positionId: string): Promise<void> {
    // 1. Look up position from DB
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { id: true, protocol: true, config: true },
    });
    if (!position) {
      log.warn({ positionId }, 'Position not found for position.created event');
      return;
    }

    // 2. Filter by protocol — handle both UniswapV3 NFT and vault positions (same pools)
    if (!['uniswapv3', 'uniswapv3-vault'].includes(position.protocol)) {
      log.debug({ protocol: position.protocol, positionId }, 'Ignoring non-UniswapV3 position');
      return;
    }

    // 3. Extract and validate config
    const config = position.config as unknown as PositionConfig;
    if (!config.chainId || !config.poolAddress) {
      log.warn({ positionId }, 'Position config missing chainId or poolAddress');
      return;
    }

    // 4. Validate chain support
    if (!isSupportedChain(config.chainId)) {
      log.debug({ chainId: config.chainId, positionId }, 'Unsupported chain, ignoring');
      return;
    }

    const chainId = config.chainId;
    const normalizedAddress = config.poolAddress.toLowerCase();

    // 5. Skip if pool already subscribed (idempotency)
    if (this.subscribedPools.has(normalizedAddress)) {
      log.debug({ poolAddress: normalizedAddress, positionId }, 'Pool already subscribed, skipping');
      return;
    }

    // 6. Compute pool ID from chain/address
    const poolId = `uniswapv3/${chainId}/${normalizedAddress}`;

    // 7. Track and add to polling batch
    this.subscribedPools.set(normalizedAddress, {
      poolId,
      poolAddress: normalizedAddress,
      chainId,
    });

    const poolInfo: PoolInfo = {
      address: normalizedAddress,
      poolId,
    };

    log.info({ chainId, poolAddress: normalizedAddress, positionId }, 'Adding pool from position.created event');
    await this.addPoolToBatch(chainId, poolInfo);
  }

  /**
   * Handle position.deleted or position.burned domain event.
   * Removes the pool from subscriptions if no other active positions use it.
   * Works for both NFT and vault positions by looking up position by DB ID.
   *
   * @param positionId - Position database ID (from event.entityId)
   * @param reason - Why the position was removed
   */
  async handlePositionRemoved(
    positionId: string,
    reason: 'closed' | 'deleted' | 'burned'
  ): Promise<void> {
    // 1. Find position by database ID (works for any protocol)
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: {
        id: true,
        config: true,
      },
    });

    if (!position) {
      log.debug({ positionId, reason }, 'Position not found in database');
      return;
    }

    // 2. Get pool address from position config
    const posConfig = position.config as unknown as { poolAddress: string; chainId: number };
    const poolAddress = posConfig.poolAddress?.toLowerCase();
    const chainId = posConfig.chainId;

    if (!poolAddress || !chainId) {
      log.warn({ positionId, reason }, 'Pool address or chainId not found in position config');
      return;
    }

    if (!isSupportedChain(chainId)) {
      log.debug({ chainId, positionId }, 'Unsupported chain, ignoring');
      return;
    }

    // 3. Check if pool is tracked
    if (!this.subscribedPools.has(poolAddress)) {
      log.debug({ poolAddress, reason }, 'Pool not subscribed, skipping');
      return;
    }

    // 4. Check if other active positions (NFT or vault) still use this pool
    const otherActivePositions = await prisma.position.count({
      where: {
        isActive: true,
        protocol: { in: ['uniswapv3', 'uniswapv3-vault'] },
        id: { not: position.id },
        config: { path: ['poolAddress'], string_contains: posConfig.poolAddress },
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
      { poolAddress, chainId, reason },
      'Pool has no more active positions, removing subscription'
    );

    const poolSub = this.subscribedPools.get(poolAddress);
    this.subscribedPools.delete(poolAddress);

    // 7. Remove from polling batch
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
  private async addPoolToBatch(chainId: number, pool: PoolInfo): Promise<void> {
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
      const newBatch = new UniswapV3PoolSubscriptionBatch(chainId, batchIndex, [pool]);
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

    // Query active positions to determine which pools still have active positions
    const activePositions = await prisma.position.findMany({
      where: {
        isActive: true,
        protocol: { in: ['uniswapv3', 'uniswapv3-vault'] },
      },
      select: { config: true },
    });

    // Build set of active pool addresses
    const activePoolIds = new Set<string>();
    for (const pos of activePositions) {
      const config = pos.config as unknown as { chainId: number; poolAddress: string };
      if (config.chainId && config.poolAddress) {
        activePoolIds.add(`uniswapv3/${config.chainId}/${config.poolAddress.toLowerCase()}`);
      }
    }

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

      // Remove from polling batch
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
