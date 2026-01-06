/**
 * Price Monitor Worker
 *
 * Polls pool prices for pools with active close orders.
 * Publishes trigger events to RabbitMQ when price conditions are met.
 */

import { getPoolSubscriptionService, getCloseOrderService, getUniswapV3PoolService, getPositionService } from '../lib/services';
import { readPoolPrice, type SupportedChainId } from '../lib/evm';
import { isSupportedChain, getWorkerConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology';
import { serializeMessage, type OrderTriggerMessage } from '../mq/messages';
import { pricePerToken0InToken1, pricePerToken1InToken0, formatCurrency } from '@midcurve/shared';

const log = automationLogger.child({ component: 'PriceMonitor' });

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

export interface PriceMonitorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  poolsMonitored: number;
  lastPollAt: string | null;
  pollIntervalMs: number;
  triggeredOrdersTotal: number;
}

// =============================================================================
// Worker
// =============================================================================

export class PriceMonitor {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private poolsMonitored = 0;
  private lastPollAt: Date | null = null;
  private triggeredOrdersTotal = 0;

  constructor() {
    const config = getWorkerConfig();
    this.pollIntervalMs = config.pricePollIntervalMs;
  }

  /**
   * Start the price monitor
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'PriceMonitor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'PriceMonitor', 'starting');
    this.status = 'running';

    // Start polling loop
    this.schedulePoll();

    autoLog.workerLifecycle(log, 'PriceMonitor', 'started', {
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * Stop the price monitor
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'PriceMonitor', 'stopping');
    this.status = 'stopping';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'PriceMonitor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): PriceMonitorStatus {
    return {
      status: this.status,
      poolsMonitored: this.poolsMonitored,
      lastPollAt: this.lastPollAt?.toISOString() || null,
      pollIntervalMs: this.pollIntervalMs,
      triggeredOrdersTotal: this.triggeredOrdersTotal,
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

    // Get pools with active orders
    const subscriptionService = getPoolSubscriptionService();
    const poolService = getUniswapV3PoolService();
    const subscriptions = await subscriptionService.getSubscriptionsToMonitor();

    this.poolsMonitored = subscriptions.length;

    if (subscriptions.length === 0) {
      return;
    }

    let triggeredCount = 0;

    // Check each pool
    for (const subscription of subscriptions) {
      try {
        // Get pool details (chainId and address) from the Pool table
        const pool = await poolService.findById(subscription.poolId);
        if (!pool) {
          log.warn({ poolId: subscription.poolId, msg: 'Pool not found for subscription' });
          continue;
        }

        // Extract chain and address from pool config
        const poolConfig = pool.config as { chainId?: number; address?: string };
        const chainId = poolConfig.chainId;
        const poolAddress = poolConfig.address;

        if (!chainId || !poolAddress) {
          log.warn({ poolId: subscription.poolId, msg: 'Pool missing chainId or address' });
          continue;
        }

        // Skip unsupported chains
        if (!isSupportedChain(chainId)) {
          log.warn({ chainId, poolId: subscription.poolId, msg: 'Unsupported chain' });
          continue;
        }

        // Read current price
        const { sqrtPriceX96, tick } = await readPoolPrice(
          chainId as SupportedChainId,
          poolAddress as `0x${string}`
        );

        // Update subscription with current price
        await subscriptionService.updatePrice(subscription.poolId, sqrtPriceX96, tick);

        // Get active orders for this pool
        const closeOrderService = getCloseOrderService();
        const orders = await closeOrderService.findActiveOrdersForPool(poolAddress);

        // Check each order for trigger condition
        for (const order of orders) {
          // Order config stores prices as strings
          const orderConfig = order.config as {
            sqrtPriceX96Lower?: string;
            sqrtPriceX96Upper?: string;
          };

          const triggered = await this.checkTrigger(
            order.id,
            order.positionId,
            poolAddress,
            chainId,
            sqrtPriceX96,
            {
              sqrtPriceX96Lower: BigInt(orderConfig.sqrtPriceX96Lower || '0'),
              sqrtPriceX96Upper: BigInt(orderConfig.sqrtPriceX96Upper || '0'),
            }
          );

          if (triggered) {
            triggeredCount++;
            this.triggeredOrdersTotal++;
          }
        }
      } catch (err) {
        autoLog.methodError(log, 'poll.pool', err, {
          poolId: subscription.poolId,
        });
      }
    }

    this.lastPollAt = new Date();
    const durationMs = Date.now() - startTime;

    autoLog.pricePoll(log, this.poolsMonitored, triggeredCount, durationMs);
  }

  /**
   * Check if an order's trigger condition is met
   *
   * Converts sqrtPriceX96 values to actual token prices before comparison,
   * taking isToken0Quote into account to handle inverted price relationships.
   */
  private async checkTrigger(
    orderId: string,
    positionId: string,
    poolAddress: string,
    chainId: number,
    currentSqrtPrice: bigint,
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
    const currentPrice = sqrtPriceToActualPrice(currentSqrtPrice, isToken0Quote, baseTokenDecimals);
    const lowerTriggerPrice = sqrtPriceX96Lower > 0n
      ? sqrtPriceToActualPrice(sqrtPriceX96Lower, isToken0Quote, baseTokenDecimals)
      : 0n;
    const upperTriggerPrice = sqrtPriceX96Upper > 0n
      ? sqrtPriceToActualPrice(sqrtPriceX96Upper, isToken0Quote, baseTokenDecimals)
      : 0n;

    let triggerSide: 'lower' | 'upper' | null = null;
    let triggerPrice: bigint | null = null;

    // Compare ACTUAL prices (not sqrtPrices)
    // Lower trigger = stop loss: actual price dropped to or below threshold
    if (lowerTriggerPrice > 0n && currentPrice <= lowerTriggerPrice) {
      triggerSide = 'lower';
      triggerPrice = lowerTriggerPrice;
    }
    // Upper trigger = take profit: actual price rose to or above threshold
    else if (upperTriggerPrice > 0n && currentPrice >= upperTriggerPrice) {
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
    const currentPriceFormatted = formatCurrency(currentPrice.toString(), quoteTokenDecimals);
    const triggerPriceFormatted = formatCurrency(triggerPrice.toString(), quoteTokenDecimals);

    autoLog.orderTriggered(
      log,
      orderId,
      positionId,
      poolAddress,
      currentPriceFormatted,
      triggerPriceFormatted
    );

    // Publish trigger message (with raw prices for precision)
    await this.publishTrigger({
      orderId,
      positionId,
      poolAddress,
      chainId,
      currentPrice: currentPrice.toString(),
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
    });
  }
}
