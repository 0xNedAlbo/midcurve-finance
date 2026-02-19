/**
 * Close Order Monitor
 *
 * Consumes raw Swap events from the pool-prices exchange via PoolPriceSubscriber
 * and checks for trigger conditions on close orders.
 *
 * Key design:
 * - 1 PoolPriceSubscriber per active order
 * - Subscriber lifecycle tied to order lifecycle
 * - Multiple subscribers for same pool is OK (RabbitMQ handles fan-out)
 * - No deduplication needed (pool-prices backend handles that)
 *
 * Trigger detection for close orders uses direct TICK comparison:
 * - LOWER (triggerMode=0): triggered when currentTick <= triggerTick
 * - UPPER (triggerMode=1): triggered when currentTick >= triggerTick
 */

import { prisma } from '@midcurve/database';
import type { CloseOrder } from '@midcurve/database';
import { getCloseOrderService } from '../lib/services';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology';
import {
  serializeMessage,
  type OrderTriggerMessage,
} from '../mq/messages';
import {
  createPoolPriceSubscriber,
  type PoolPriceSubscriber,
  type RawSwapEventWrapper,
} from '@midcurve/services';

const log = automationLogger.child({ component: 'CloseOrderMonitor' });

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

export interface CloseOrderMonitorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  orderSubscribers: number;
  eventsProcessed: number;
  triggersPublished: number;
  lastProcessedAt: string | null;
  lastSyncAt: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract sqrtPriceX96, tick, and blockNumber from raw Swap event
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

export class CloseOrderMonitor {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private orderSubscribers = new Map<string, PoolPriceSubscriber>();
  private eventsProcessed = 0;
  private triggersPublished = 0;
  private lastProcessedAt: Date | null = null;
  private lastSyncAt: Date | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  /**
   * Start the close order monitor
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'CloseOrderMonitor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'CloseOrderMonitor', 'starting');
    this.status = 'running';

    try {
      // Sync subscriptions on startup
      await this.syncSubscriptions();

      // Schedule periodic subscription sync
      this.scheduleSyncTimer();

      autoLog.workerLifecycle(log, 'CloseOrderMonitor', 'started', {
        orderSubscribers: this.orderSubscribers.size,
      });
    } catch (err) {
      this.status = 'stopped';
      autoLog.methodError(log, 'start', err);
      throw err;
    }
  }

  /**
   * Stop the close order monitor
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'CloseOrderMonitor', 'stopping');
    this.status = 'stopping';

    // Stop sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Shutdown all order subscribers
    const orderShutdowns = Array.from(this.orderSubscribers.values()).map((sub) =>
      sub.shutdown().catch((err) => {
        log.warn({ error: err, msg: 'Error shutting down order subscriber' });
      })
    );

    await Promise.all(orderShutdowns);

    this.orderSubscribers.clear();

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'CloseOrderMonitor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): CloseOrderMonitorStatus {
    return {
      status: this.status,
      orderSubscribers: this.orderSubscribers.size,
      eventsProcessed: this.eventsProcessed,
      triggersPublished: this.triggersPublished,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
      lastSyncAt: this.lastSyncAt?.toISOString() || null,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Sync subscriptions with active orders
   */
  private async syncSubscriptions(): Promise<void> {
    autoLog.methodEntry(log, 'syncSubscriptions');

    try {
      await this.syncOrderSubscriptions();

      this.lastSyncAt = new Date();

      log.info({
        orderSubscribers: this.orderSubscribers.size,
        msg: 'Subscription sync complete',
      });

      autoLog.methodExit(log, 'syncSubscriptions');
    } catch (err) {
      autoLog.methodError(log, 'syncSubscriptions', err);
    }
  }

  /**
   * Sync order subscriptions using CloseOrderService
   */
  private async syncOrderSubscriptions(): Promise<void> {
    const closeOrderService = getCloseOrderService();

    // Get all monitoring orders with position→pool relations
    const monitoringOrders = await closeOrderService.findMonitoringOrders();

    // Get set of active order IDs
    const activeOrderIds = new Set(monitoringOrders.map((o) => o.id));

    // Remove subscribers for orders that are no longer monitoring
    for (const [orderId, subscriber] of this.orderSubscribers.entries()) {
      if (!activeOrderIds.has(orderId)) {
        log.debug({ orderId }, 'Removing subscriber for inactive order');
        await subscriber.shutdown().catch((err) => {
          log.warn({ error: err, orderId, msg: 'Error shutting down order subscriber' });
        });
        this.orderSubscribers.delete(orderId);
      }
    }

    // Add subscribers for new monitoring orders
    for (const order of monitoringOrders) {
      if (!this.orderSubscribers.has(order.id)) {
        // Extract pool data from position→pool relation
        const poolId = order.position?.pool?.id;
        const poolConfig = order.position?.pool?.config as Record<string, unknown> | null;
        const poolAddress = poolConfig?.address as string | undefined;
        // Extract chainId from order config JSON
        const orderConfig = (order.config ?? {}) as Record<string, unknown>;
        const chainId = orderConfig.chainId as number | undefined;

        if (poolAddress && poolId && chainId) {
          await this.createOrderSubscriber({
            id: order.id,
            positionId: order.positionId,
            poolAddress,
            poolId,
            chainId,
          });
        } else {
          log.warn({
            orderId: order.id,
            poolAddress,
            poolId,
            chainId,
            msg: 'Cannot create subscriber: missing pool data or chainId',
          });
        }
      }
    }
  }

  /**
   * Create a subscriber for an order
   */
  private async createOrderSubscriber(order: {
    id: string;
    positionId: string;
    poolAddress: string;
    poolId: string;
    chainId: number;
  }): Promise<void> {
    try {
      // Create or find the subscriber record in the database
      const subscriptionTag = `order-trigger-${order.id}`;

      // Try to find existing record
      let subscriberRecord = await prisma.poolPriceSubscribers.findFirst({
        where: {
          poolId: order.poolId,
          subscriptionTag,
        },
      });

      // Create if not found
      if (!subscriberRecord) {
        subscriberRecord = await prisma.poolPriceSubscribers.create({
          data: {
            poolId: order.poolId,
            subscriptionTag,
            isActive: true,
          },
        });
        log.debug({ orderId: order.id, subscriptionTag }, 'Created subscriber record');
      } else {
        // Update existing to mark as active
        await prisma.poolPriceSubscribers.update({
          where: { id: subscriberRecord.id },
          data: { isActive: true },
        });
        log.debug({ orderId: order.id, subscriptionTag }, 'Reusing existing subscriber record');
      }

      const subscriber = createPoolPriceSubscriber({
        subscriberId: subscriberRecord.id,
        chainId: order.chainId,
        poolAddress: order.poolAddress,
        messageHandler: async (message) => {
          await this.handleOrderSwapEvent(order.id, message);
        },
        errorHandler: async (error) => {
          log.error({ error: error.message, orderId: order.id }, 'Order subscriber error');
          // Remove from map so it can be recreated on next sync
          this.orderSubscribers.delete(order.id);
        },
      });

      await subscriber.start();
      this.orderSubscribers.set(order.id, subscriber);
      log.info({
        orderId: order.id,
        chainId: order.chainId,
        poolAddress: order.poolAddress,
        subscriberId: subscriberRecord.id,
        msg: 'Created order subscriber',
      });
    } catch (err) {
      log.error({ error: err, orderId: order.id, msg: 'Failed to start order subscriber' });
    }
  }

  /**
   * Handle Swap event for an order — tick-based trigger detection
   */
  private async handleOrderSwapEvent(
    orderId: string,
    message: RawSwapEventWrapper
  ): Promise<void> {
    this.eventsProcessed++;
    this.lastProcessedAt = new Date();

    try {
      // Get fresh order data (may have been modified)
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findById(orderId);

      if (!order) {
        log.debug({ orderId }, 'Order not found, shutting down subscriber');
        await this.shutdownOrderSubscriber(orderId);
        return;
      }

      if (order.monitoringState !== 'monitoring') {
        log.debug({ orderId, monitoringState: order.monitoringState }, 'Order no longer monitoring');
        await this.shutdownOrderSubscriber(orderId);
        return;
      }

      const { sqrtPriceX96, tick } = extractSwapData(message.raw);

      const triggered = await this.checkOrderTrigger(
        order,
        message.poolAddress,
        message.chainId,
        sqrtPriceX96,
        tick
      );

      if (triggered) {
        this.triggersPublished++;
        // Shutdown subscriber since order is now triggered
        await this.shutdownOrderSubscriber(orderId);
      }
    } catch (err) {
      autoLog.methodError(log, 'handleOrderSwapEvent', err, { orderId });
    }
  }

  /**
   * Shutdown an order subscriber
   */
  private async shutdownOrderSubscriber(orderId: string): Promise<void> {
    const subscriber = this.orderSubscribers.get(orderId);
    if (subscriber) {
      await subscriber.shutdown().catch((err) => {
        log.warn({ error: err, orderId, msg: 'Error shutting down order subscriber' });
      });
      this.orderSubscribers.delete(orderId);
    }
  }

  /**
   * Check if an order's trigger condition is met using direct tick comparison.
   *
   * Extracts triggerTick from state JSON and triggerMode from config JSON.
   * - LOWER (triggerMode=0): triggered when currentTick <= triggerTick
   * - UPPER (triggerMode=1): triggered when currentTick >= triggerTick
   */
  private async checkOrderTrigger(
    order: CloseOrder,
    poolAddress: string,
    chainId: number,
    currentSqrtPriceX96: bigint,
    currentTick: number
  ): Promise<boolean> {
    const config = (order.config ?? {}) as Record<string, unknown>;
    const state = (order.state ?? {}) as Record<string, unknown>;
    const triggerTick = state.triggerTick as number | null | undefined;
    const triggerMode = config.triggerMode as number;

    // Guard: triggerTick must be set
    if (triggerTick === null || triggerTick === undefined) {
      log.warn({ orderId: order.id, msg: 'Order has no triggerTick set' });
      return false;
    }

    // Tick-based trigger comparison
    let triggered = false;
    let triggerSide: 'lower' | 'upper';

    if (triggerMode === 0) {
      // LOWER: triggered when currentTick <= triggerTick
      triggered = currentTick <= triggerTick;
      triggerSide = 'lower';
    } else {
      // UPPER: triggered when currentTick >= triggerTick
      triggered = currentTick >= triggerTick;
      triggerSide = 'upper';
    }

    if (!triggered) {
      return false;
    }

    // Verify order is still monitoring before publishing (race safety)
    const closeOrderService = getCloseOrderService();
    const freshOrder = await closeOrderService.findById(order.id);
    if (!freshOrder || freshOrder.monitoringState !== 'monitoring') {
      log.debug(
        { orderId: order.id, monitoringState: freshOrder?.monitoringState },
        'Order no longer monitoring, skipping trigger'
      );
      return false;
    }

    // Log trigger detection
    autoLog.orderTriggered(
      log,
      order.id,
      order.positionId,
      poolAddress,
      `tick=${currentTick}`,
      `triggerTick=${triggerTick}`
    );

    // Publish trigger message
    // Include currentSqrtPriceX96 as the price context for the executor
    await this.publishOrderTrigger({
      orderId: order.id,
      positionId: order.positionId,
      poolAddress,
      chainId,
      currentPrice: currentSqrtPriceX96.toString(),
      triggerPrice: currentSqrtPriceX96.toString(),
      triggerSide,
      triggeredAt: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Publish order trigger message
   */
  private async publishOrderTrigger(message: OrderTriggerMessage): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(message);

    await mq.publish(EXCHANGES.TRIGGERS, ROUTING_KEYS.ORDER_TRIGGERED, content);

    autoLog.mqEvent(log, 'published', EXCHANGES.TRIGGERS, {
      orderId: message.orderId,
      routingKey: ROUTING_KEYS.ORDER_TRIGGERED,
      source: 'pool-price',
    });
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
