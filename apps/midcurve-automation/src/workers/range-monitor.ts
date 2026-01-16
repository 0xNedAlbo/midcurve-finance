/**
 * Range Monitor Worker
 *
 * Polls pool prices for ALL pools with active user positions.
 * Detects when positions go in/out of range and publishes notification events.
 */

import { getPositionRangeTrackerService, getUniswapV3PoolService } from '../lib/services';
import { readPoolPrice, type SupportedChainId } from '../lib/evm';
import { isSupportedChain, getWorkerConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology';
import { serializeMessage, type RangeChangeNotificationMessage } from '../mq/messages';

const log = automationLogger.child({ component: 'RangeMonitor' });

// =============================================================================
// Types
// =============================================================================

export interface RangeMonitorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  poolsMonitored: number;
  positionsChecked: number;
  lastPollAt: string | null;
  pollIntervalMs: number;
  rangeChangesDetected: number;
}

// =============================================================================
// Worker
// =============================================================================

export class RangeMonitor {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private poolsMonitored = 0;
  private positionsChecked = 0;
  private lastPollAt: Date | null = null;
  private rangeChangesDetected = 0;

  constructor() {
    const config = getWorkerConfig();
    // Use the same poll interval as price monitor, or a separate config if needed
    this.pollIntervalMs = config.pricePollIntervalMs;
  }

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

    // Start polling loop
    this.schedulePoll();

    autoLog.workerLifecycle(log, 'RangeMonitor', 'started', {
      pollIntervalMs: this.pollIntervalMs,
    });
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

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'RangeMonitor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): RangeMonitorStatus {
    return {
      status: this.status,
      poolsMonitored: this.poolsMonitored,
      positionsChecked: this.positionsChecked,
      lastPollAt: this.lastPollAt?.toISOString() || null,
      pollIntervalMs: this.pollIntervalMs,
      rangeChangesDetected: this.rangeChangesDetected,
    };
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (this.status !== 'running') {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (err) {
        autoLog.methodError(log, 'poll', err);
      }

      // Schedule next poll
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Execute one poll cycle
   */
  private async poll(): Promise<void> {
    const startTime = Date.now();

    const rangeTrackerService = getPositionRangeTrackerService();
    const poolService = getUniswapV3PoolService();

    // Get all unique pools with active positions
    const poolIds = await rangeTrackerService.getActivePoolIds();

    this.poolsMonitored = poolIds.length;
    let totalPositionsChecked = 0;
    let rangeChangesInCycle = 0;

    if (poolIds.length === 0) {
      return;
    }

    // Check each pool
    for (const poolId of poolIds) {
      try {
        // Get pool details
        const pool = await poolService.findById(poolId);
        if (!pool) {
          log.warn({ poolId, msg: 'Pool not found' });
          continue;
        }

        // Extract chain and address from pool config
        const poolConfig = pool.config as { chainId?: number; address?: string };
        const chainId = poolConfig.chainId;
        const poolAddress = poolConfig.address;

        if (!chainId || !poolAddress) {
          log.warn({ poolId, msg: 'Pool missing chainId or address' });
          continue;
        }

        // Skip unsupported chains
        if (!isSupportedChain(chainId)) {
          continue;
        }

        // Read current price
        const { sqrtPriceX96, tick } = await readPoolPrice(
          chainId as SupportedChainId,
          poolAddress as `0x${string}`
        );

        // Get all positions for this pool and check their range status
        const changes = await rangeTrackerService.batchCheckAndUpdate(
          poolId,
          tick,
          sqrtPriceX96.toString()
        );

        // Get positions info for publishing messages
        const positions = await rangeTrackerService.getPositionsForPool(poolId);
        totalPositionsChecked += positions.length;

        // Publish notification events for any status changes
        for (const change of changes) {
          const position = positions.find((p) => p.positionId === change.positionId);
          if (!position) continue;

          const eventType = change.nowInRange ? 'POSITION_IN_RANGE' : 'POSITION_OUT_OF_RANGE';

          await this.publishRangeChangeNotification({
            userId: change.userId,
            positionId: change.positionId,
            poolId,
            poolAddress,
            chainId,
            eventType,
            currentTick: change.currentTick,
            currentSqrtPriceX96: change.sqrtPriceX96,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            detectedAt: new Date().toISOString(),
          });

          rangeChangesInCycle++;
          this.rangeChangesDetected++;
        }
      } catch (err) {
        autoLog.methodError(log, 'poll.pool', err, { poolId });
      }
    }

    this.positionsChecked = totalPositionsChecked;
    this.lastPollAt = new Date();
    const durationMs = Date.now() - startTime;

    if (rangeChangesInCycle > 0 || this.poolsMonitored > 0) {
      log.info(
        {
          poolsMonitored: this.poolsMonitored,
          positionsChecked: totalPositionsChecked,
          rangeChanges: rangeChangesInCycle,
          durationMs,
        },
        'Range monitor poll completed'
      );
    }
  }

  /**
   * Publish range change notification message to RabbitMQ
   */
  private async publishRangeChangeNotification(
    message: RangeChangeNotificationMessage
  ): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(message);

    await mq.publish(EXCHANGES.NOTIFICATIONS, ROUTING_KEYS.NOTIFICATION_RANGE_CHANGE, content);

    log.info(
      {
        userId: message.userId,
        positionId: message.positionId,
        eventType: message.eventType,
        routingKey: ROUTING_KEYS.NOTIFICATION_RANGE_CHANGE,
      },
      'Range change notification published'
    );
  }
}
