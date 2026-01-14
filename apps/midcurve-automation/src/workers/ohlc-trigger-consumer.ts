/**
 * OHLC Trigger Consumer
 *
 * Consumes OHLC candles from the ohlc.uniswapv3.1m queue and checks
 * for trigger conditions using the Close price only.
 *
 * This is an alternative to the RPC-polling PriceMonitor, using
 * event-driven OHLC data instead.
 */

import {
  getCloseOrderService,
  getPositionService,
} from '../lib/services';
import { automationLogger, autoLog } from '../lib/logger';
import {
  getRabbitMQConnection,
  type ConsumeMessage,
} from '../mq/connection-manager';
import { EXCHANGES, QUEUES, ROUTING_KEYS } from '../mq/topology';
import {
  serializeMessage,
  deserializeMessage,
  type OrderTriggerMessage,
} from '../mq/messages';
import type { UniswapV3OhlcCandle } from '../types/ohlc-uniswapv3';
import { getUniswapV3OhlcWorker } from './ohlc/uniswapv3/worker';
import { pricePerToken0InToken1, pricePerToken1InToken0, formatCurrency } from '@midcurve/shared';

const log = automationLogger.child({ component: 'OhlcTriggerConsumer' });

// =============================================================================
// Constants
// =============================================================================

/** Interval for syncing OHLC subscriptions (5 minutes) */
const SUBSCRIPTION_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert sqrtPriceX96 to actual token price (quote per base)
 * Takes isToken0Quote into account to return the user-facing price
 *
 * When isToken0Quote=true: quote=token0, base=token1, price=token0/token1
 * When isToken0Quote=false: quote=token1, base=token0, price=token1/token0
 */
function sqrtPriceToActualPrice(
  sqrtPriceX96: bigint,
  isToken0Quote: boolean,
  baseTokenDecimals: number
): bigint {
  if (isToken0Quote) {
    // quote = token0, base = token1
    // Price = token0 per token1
    return pricePerToken1InToken0(sqrtPriceX96, baseTokenDecimals);
  } else {
    // quote = token1, base = token0
    // Price = token1 per token0
    return pricePerToken0InToken1(sqrtPriceX96, baseTokenDecimals);
  }
}

// =============================================================================
// Types
// =============================================================================

export interface OhlcTriggerConsumerStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  candlesProcessed: number;
  triggersPublished: number;
  lastProcessedAt: string | null;
  lastSyncAt: string | null;
  poolsSubscribed: number;
}

// =============================================================================
// Worker
// =============================================================================

export class OhlcTriggerConsumer {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private consumerTag: string | null = null;
  private candlesProcessed = 0;
  private triggersPublished = 0;
  private lastProcessedAt: Date | null = null;
  private lastSyncAt: Date | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  /**
   * Start the OHLC trigger consumer
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'OhlcTriggerConsumer already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'OhlcTriggerConsumer', 'starting');
    this.status = 'running';

    try {
      // Sync OHLC subscriptions on startup
      await this.syncOhlcSubscriptions();

      // Start consuming from the OHLC queue
      const mq = getRabbitMQConnection();
      this.consumerTag = await mq.consume(
        QUEUES.OHLC_UNISWAPV3_1M,
        (msg) => this.handleMessage(msg),
        { prefetch: 10 }
      );

      // Schedule periodic subscription sync
      this.scheduleSyncTimer();

      autoLog.workerLifecycle(log, 'OhlcTriggerConsumer', 'started', {
        consumerTag: this.consumerTag,
      });
    } catch (err) {
      this.status = 'stopped';
      autoLog.methodError(log, 'start', err);
      throw err;
    }
  }

  /**
   * Stop the OHLC trigger consumer
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'OhlcTriggerConsumer', 'stopping');
    this.status = 'stopping';

    // Stop sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Cancel consumer
    if (this.consumerTag) {
      try {
        const mq = getRabbitMQConnection();
        await mq.cancelConsumer(this.consumerTag);
      } catch (err) {
        log.warn({ error: err, msg: 'Error cancelling consumer' });
      }
      this.consumerTag = null;
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'OhlcTriggerConsumer', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): OhlcTriggerConsumerStatus {
    const ohlcWorker = getUniswapV3OhlcWorker();
    return {
      status: this.status,
      candlesProcessed: this.candlesProcessed,
      triggersPublished: this.triggersPublished,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
      lastSyncAt: this.lastSyncAt?.toISOString() || null,
      poolsSubscribed: ohlcWorker.getStatus().poolsSubscribed,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle incoming OHLC candle message
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      return;
    }

    const mq = getRabbitMQConnection();

    try {
      const candle = deserializeMessage<UniswapV3OhlcCandle>(msg.content);
      await this.processCandle(candle);
      this.candlesProcessed++;
      this.lastProcessedAt = new Date();

      // Acknowledge message
      await mq.ack(msg);
    } catch (err) {
      autoLog.methodError(log, 'handleMessage', err);
      // Nack without requeue - bad messages go to DLQ (if configured) or are dropped
      await mq.nack(msg, false);
    }
  }

  /**
   * Process an OHLC candle and check for trigger conditions
   */
  private async processCandle(candle: UniswapV3OhlcCandle): Promise<void> {
    const { chainId, poolAddress, close } = candle;

    // Get active orders for this pool
    const closeOrderService = getCloseOrderService();
    const orders = await closeOrderService.findActiveOrdersForPool(poolAddress);

    if (orders.length === 0) {
      return;
    }

    log.debug({
      chainId,
      poolAddress,
      close,
      orderCount: orders.length,
      msg: 'Processing OHLC candle for triggers',
    });

    // Check each order for trigger condition using Close price
    for (const order of orders) {
      const orderConfig = order.config as {
        sqrtPriceX96Lower?: string;
        sqrtPriceX96Upper?: string;
      };

      const triggered = await this.checkTriggerWithClose(
        order.id,
        order.positionId,
        poolAddress,
        chainId,
        BigInt(close), // Use Close price
        {
          sqrtPriceX96Lower: BigInt(orderConfig.sqrtPriceX96Lower || '0'),
          sqrtPriceX96Upper: BigInt(orderConfig.sqrtPriceX96Upper || '0'),
        }
      );

      if (triggered) {
        this.triggersPublished++;
      }
    }
  }

  /**
   * Check if an order's trigger condition is met using OHLC Close price
   *
   * Uses Close price only - if price bounces back within the minute,
   * the position stays open, which is beneficial for the user.
   */
  private async checkTriggerWithClose(
    orderId: string,
    positionId: string,
    poolAddress: string,
    chainId: number,
    closeSqrtPrice: bigint,
    config: { sqrtPriceX96Lower: bigint; sqrtPriceX96Upper: bigint }
  ): Promise<boolean> {
    const { sqrtPriceX96Lower, sqrtPriceX96Upper } = config;

    // Fetch position to get isToken0Quote and token decimals
    const positionService = getPositionService();
    const position = await positionService.findById(positionId);

    if (!position) {
      log.warn({ orderId, positionId, msg: 'Position not found for trigger evaluation' });
      return false;
    }

    const { isToken0Quote } = position;
    // Base token is token1 if isToken0Quote, otherwise token0
    const baseTokenDecimals = isToken0Quote
      ? position.pool.token1.decimals
      : position.pool.token0.decimals;
    // Quote token decimals for formatting
    const quoteTokenDecimals = isToken0Quote
      ? position.pool.token0.decimals
      : position.pool.token1.decimals;

    // Convert sqrtPrices to actual token prices (quote per base)
    const closePrice = sqrtPriceToActualPrice(closeSqrtPrice, isToken0Quote, baseTokenDecimals);
    const lowerTriggerPrice = sqrtPriceX96Lower > 0n
      ? sqrtPriceToActualPrice(sqrtPriceX96Lower, isToken0Quote, baseTokenDecimals)
      : 0n;
    const upperTriggerPrice = sqrtPriceX96Upper > 0n
      ? sqrtPriceToActualPrice(sqrtPriceX96Upper, isToken0Quote, baseTokenDecimals)
      : 0n;

    let triggerSide: 'lower' | 'upper' | null = null;
    let triggerPrice: bigint | null = null;

    // Compare ACTUAL prices using Close price only
    // Lower trigger = stop loss: close price dropped to or below threshold
    if (lowerTriggerPrice > 0n && closePrice <= lowerTriggerPrice) {
      triggerSide = 'lower';
      triggerPrice = lowerTriggerPrice;
    }
    // Upper trigger = take profit: close price rose to or above threshold
    else if (upperTriggerPrice > 0n && closePrice >= upperTriggerPrice) {
      triggerSide = 'upper';
      triggerPrice = upperTriggerPrice;
    }

    if (!triggerSide || !triggerPrice) {
      return false;
    }

    // CRITICAL: Verify order is still 'active' before publishing trigger message
    // This prevents duplicate messages when the order is already being processed
    const closeOrderService = getCloseOrderService();
    const order = await closeOrderService.findById(orderId);

    if (!order) {
      log.debug({ orderId }, 'Order not found, skipping trigger');
      return false;
    }

    if (order.status !== 'active') {
      log.debug(
        { orderId, status: order.status },
        'Order no longer active, skipping trigger (already processing or completed)'
      );
      return false;
    }

    // Log with human-readable prices for clarity
    const closePriceFormatted = formatCurrency(closePrice.toString(), quoteTokenDecimals);
    const triggerPriceFormatted = formatCurrency(triggerPrice.toString(), quoteTokenDecimals);

    autoLog.orderTriggered(
      log,
      orderId,
      positionId,
      poolAddress,
      closePriceFormatted,
      triggerPriceFormatted
    );

    // Publish trigger message (with raw prices for precision)
    await this.publishTrigger({
      orderId,
      positionId,
      poolAddress,
      chainId,
      currentPrice: closePrice.toString(),
      triggerPrice: triggerPrice.toString(),
      triggerSide,
      triggeredAt: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Publish trigger message to RabbitMQ
   */
  private async publishTrigger(message: OrderTriggerMessage): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(message);

    await mq.publish(EXCHANGES.TRIGGERS, ROUTING_KEYS.ORDER_TRIGGERED, content);

    autoLog.mqEvent(log, 'published', EXCHANGES.TRIGGERS, {
      orderId: message.orderId,
      routingKey: ROUTING_KEYS.ORDER_TRIGGERED,
      source: 'ohlc',
    });
  }

  /**
   * Sync OHLC subscriptions with pools that have active orders
   */
  private async syncOhlcSubscriptions(): Promise<void> {
    autoLog.methodEntry(log, 'syncOhlcSubscriptions');

    try {
      const closeOrderService = getCloseOrderService();
      const pools = await closeOrderService.getPoolsWithActiveOrders();

      const ohlcWorker = getUniswapV3OhlcWorker();
      const currentSubscriptions = ohlcWorker.getSubscribedPools();

      // Create a set of currently subscribed pools for fast lookup
      const subscribedSet = new Set(
        currentSubscriptions.map((p) => `${p.chainId}-${p.poolAddress.toLowerCase()}`)
      );

      // Subscribe to pools that have active orders but are not subscribed
      let subscribed = 0;
      for (const pool of pools) {
        const key = `${pool.chainId}-${pool.poolAddress.toLowerCase()}`;
        if (!subscribedSet.has(key)) {
          const success = await ohlcWorker.subscribePool(pool.chainId, pool.poolAddress);
          if (success) {
            subscribed++;
            log.info({
              chainId: pool.chainId,
              poolAddress: pool.poolAddress,
              msg: 'Subscribed pool for OHLC triggers',
            });
          }
        }
      }

      this.lastSyncAt = new Date();

      log.info({
        poolsWithActiveOrders: pools.length,
        newSubscriptions: subscribed,
        totalSubscribed: ohlcWorker.getStatus().poolsSubscribed,
        msg: 'OHLC subscription sync complete',
      });

      autoLog.methodExit(log, 'syncOhlcSubscriptions');
    } catch (err) {
      autoLog.methodError(log, 'syncOhlcSubscriptions', err);
    }
  }

  /**
   * Schedule periodic subscription sync
   */
  private scheduleSyncTimer(): void {
    this.syncTimer = setInterval(() => {
      if (this.status === 'running') {
        this.syncOhlcSubscriptions().catch((err) => {
          autoLog.methodError(log, 'scheduledSync', err);
        });
      }
    }, SUBSCRIPTION_SYNC_INTERVAL_MS);

    log.debug({
      intervalMs: SUBSCRIPTION_SYNC_INTERVAL_MS,
      msg: 'Scheduled periodic OHLC subscription sync',
    });
  }
}
