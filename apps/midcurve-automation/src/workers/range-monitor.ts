/**
 * Range Monitor Worker
 *
 * Monitors pool prices for ALL pools with active user positions.
 * Detects when positions go in/out of range and publishes notification events.
 *
 * Uses PoolPriceSubscriber to receive real-time Swap events from the pool-prices
 * exchange instead of RPC polling.
 *
 * Key design:
 * - 1 PoolPriceSubscriber per pool (not per position)
 * - Multiple positions in the same pool share one subscriber
 * - Subscriber lifecycle tied to whether pool has active positions
 */

import { prisma } from '@midcurve/database';
import { getPositionRangeTrackerService, getUniswapV3PoolService, getUserNotificationService } from '../lib/services';
import { isSupportedChain } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import {
  createPoolPriceSubscriber,
  type PoolPriceSubscriber,
  type RawSwapEventWrapper,
} from '@midcurve/services';

const log = automationLogger.child({ component: 'RangeMonitor' });

// =============================================================================
// Constants
// =============================================================================

/** Interval for syncing subscriptions (5 minutes) */
const SUBSCRIPTION_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/** Viem Swap event args structure */
interface SwapEventArgs {
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
}

/** Raw log structure from viem */
interface RawSwapLog {
  args: SwapEventArgs;
  blockNumber: bigint;
}

export interface RangeMonitorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  poolSubscribers: number;
  positionsTracked: number;
  eventsProcessed: number;
  rangeChangesDetected: number;
  lastEventAt: string | null;
  lastSyncAt: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract sqrtPriceX96 and tick from raw Swap event
 */
function extractSwapData(raw: unknown): { sqrtPriceX96: bigint; tick: number; blockNumber: bigint } {
  const swapLog = raw as RawSwapLog;
  return {
    sqrtPriceX96: BigInt(swapLog.args.sqrtPriceX96),
    tick: Number(swapLog.args.tick),
    blockNumber: BigInt(swapLog.blockNumber),
  };
}

// =============================================================================
// Worker
// =============================================================================

export class RangeMonitor {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private poolSubscribers = new Map<string, PoolPriceSubscriber>();
  private positionsTracked = 0;
  private eventsProcessed = 0;
  private rangeChangesDetected = 0;
  private lastEventAt: Date | null = null;
  private lastSyncAt: Date | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  /**
   * Start the range monitor
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'RangeMonitor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'RangeMonitor', 'starting');
    this.status = 'running';

    try {
      // Sync subscriptions on startup
      await this.syncSubscriptions();

      // Schedule periodic subscription sync
      this.scheduleSyncTimer();

      autoLog.workerLifecycle(log, 'RangeMonitor', 'started', {
        poolSubscribers: this.poolSubscribers.size,
      });
    } catch (err) {
      this.status = 'stopped';
      autoLog.methodError(log, 'start', err);
      throw err;
    }
  }

  /**
   * Stop the range monitor
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'RangeMonitor', 'stopping');
    this.status = 'stopping';

    // Stop sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Shutdown all pool subscribers
    const shutdowns = Array.from(this.poolSubscribers.values()).map((sub) =>
      sub.shutdown().catch((err) => {
        log.warn({ error: err, msg: 'Error shutting down pool subscriber' });
      })
    );

    await Promise.all(shutdowns);
    this.poolSubscribers.clear();

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'RangeMonitor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): RangeMonitorStatus {
    return {
      status: this.status,
      poolSubscribers: this.poolSubscribers.size,
      positionsTracked: this.positionsTracked,
      eventsProcessed: this.eventsProcessed,
      rangeChangesDetected: this.rangeChangesDetected,
      lastEventAt: this.lastEventAt?.toISOString() || null,
      lastSyncAt: this.lastSyncAt?.toISOString() || null,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Sync subscriptions with active pools
   */
  private async syncSubscriptions(): Promise<void> {
    autoLog.methodEntry(log, 'syncSubscriptions');

    try {
      const rangeTrackerService = getPositionRangeTrackerService();
      const poolService = getUniswapV3PoolService();

      // Get all unique pools with active positions
      const activePoolIds = await rangeTrackerService.getActivePoolIds();
      const activePoolIdSet = new Set(activePoolIds);

      // Remove subscribers for pools that no longer have active positions
      for (const [poolId, subscriber] of this.poolSubscribers.entries()) {
        if (!activePoolIdSet.has(poolId)) {
          log.debug({ poolId }, 'Removing subscriber for pool with no active positions');
          await subscriber.shutdown().catch((err) => {
            log.warn({ error: err, poolId, msg: 'Error shutting down pool subscriber' });
          });
          this.poolSubscribers.delete(poolId);
        }
      }

      // Add subscribers for new active pools and count total positions
      let totalPositions = 0;
      for (const poolId of activePoolIds) {
        // Count positions for this pool
        const positions = await rangeTrackerService.getPositionsForPool(poolId);
        totalPositions += positions.length;

        if (this.poolSubscribers.has(poolId)) {
          continue;
        }

        // Get pool details
        const pool = await poolService.findById(poolId);
        if (!pool) {
          log.warn({ poolId, msg: 'Pool not found' });
          continue;
        }

        const poolConfig = pool.config as { chainId?: number; address?: string };
        const chainId = poolConfig.chainId;
        const poolAddress = poolConfig.address;

        if (!chainId || !poolAddress) {
          log.warn({ poolId, msg: 'Pool missing chainId or address' });
          continue;
        }

        // Skip unsupported chains
        if (!isSupportedChain(chainId)) {
          log.debug({ poolId, chainId, msg: 'Skipping unsupported chain' });
          continue;
        }

        await this.createPoolSubscriber(poolId, chainId, poolAddress);
      }

      this.positionsTracked = totalPositions;
      this.lastSyncAt = new Date();

      log.info({
        poolSubscribers: this.poolSubscribers.size,
        positionsTracked: this.positionsTracked,
        activePoolIds: activePoolIds.length,
        msg: 'Subscription sync complete',
      });

      autoLog.methodExit(log, 'syncSubscriptions');
    } catch (err) {
      autoLog.methodError(log, 'syncSubscriptions', err);
    }
  }

  /**
   * Create a subscriber for a pool
   */
  private async createPoolSubscriber(
    poolId: string,
    chainId: number,
    poolAddress: string
  ): Promise<void> {
    try {
      // Create or find the subscriber record in the database
      const subscriptionTag = `range-monitor-${poolId}`;

      // Try to find existing record
      let subscriberRecord = await prisma.poolPriceSubscribers.findFirst({
        where: {
          poolId,
          subscriptionTag,
        },
      });

      // Create if not found
      if (!subscriberRecord) {
        subscriberRecord = await prisma.poolPriceSubscribers.create({
          data: {
            poolId,
            subscriptionTag,
            isActive: true,
          },
        });
        log.debug({ poolId, subscriptionTag }, 'Created subscriber record');
      } else {
        // Update existing to mark as active
        await prisma.poolPriceSubscribers.update({
          where: { id: subscriberRecord.id },
          data: { isActive: true },
        });
        log.debug({ poolId, subscriptionTag }, 'Reusing existing subscriber record');
      }

      const subscriber = createPoolPriceSubscriber({
        subscriberId: subscriberRecord.id,
        chainId,
        poolAddress,
        messageHandler: async (message) => {
          await this.handleSwapEvent(poolId, message);
        },
        errorHandler: async (error) => {
          log.error({ error: error.message, poolId }, 'Pool subscriber error');
          // Remove from map so it can be recreated on next sync
          this.poolSubscribers.delete(poolId);
        },
      });

      await subscriber.start();
      this.poolSubscribers.set(poolId, subscriber);
      log.info({
        poolId,
        chainId,
        poolAddress,
        subscriberId: subscriberRecord.id,
        msg: 'Created pool subscriber',
      });
    } catch (err) {
      log.error({ error: err, poolId, msg: 'Failed to start pool subscriber' });
    }
  }

  /**
   * Handle Swap event for a pool
   */
  private async handleSwapEvent(poolId: string, message: RawSwapEventWrapper): Promise<void> {
    this.eventsProcessed++;
    this.lastEventAt = new Date();

    try {
      const { sqrtPriceX96, tick } = extractSwapData(message.raw);
      const rangeTrackerService = getPositionRangeTrackerService();

      // Check all positions for this pool and detect range changes
      const changes = await rangeTrackerService.batchCheckAndUpdate(
        poolId,
        tick,
        sqrtPriceX96.toString()
      );

      if (changes.length === 0) {
        return;
      }

      // Get positions info for publishing messages
      const positions = await rangeTrackerService.getPositionsForPool(poolId);

      // Publish notification events for any status changes
      for (const change of changes) {
        const position = positions.find((p) => p.positionId === change.positionId);
        if (!position) continue;

        const userNotificationService = getUserNotificationService();
        const notifyMethod = change.nowInRange
          ? userNotificationService.notifyPositionInRange
          : userNotificationService.notifyPositionOutOfRange;

        await notifyMethod.call(userNotificationService, {
          userId: change.userId,
          positionId: change.positionId,
          poolId,
          poolAddress: message.poolAddress,
          chainId: message.chainId,
          currentTick: change.currentTick,
          currentSqrtPriceX96: change.sqrtPriceX96,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
        });

        this.rangeChangesDetected++;
      }

      log.debug({
        poolId,
        rangeChanges: changes.length,
        msg: 'Processed swap event',
      });
    } catch (err) {
      autoLog.methodError(log, 'handleSwapEvent', err, { poolId });
    }
  }

  /**
   * Schedule periodic subscription sync
   */
  private scheduleSyncTimer(): void {
    this.syncTimer = setInterval(() => {
      if (this.status === 'running') {
        this.syncSubscriptions().catch((err) => {
          autoLog.methodError(log, 'scheduledSync', err);
        });
      }
    }, SUBSCRIPTION_SYNC_INTERVAL_MS);

    log.debug({
      intervalMs: SUBSCRIPTION_SYNC_INTERVAL_MS,
      msg: 'Scheduled periodic subscription sync',
    });
  }
}
