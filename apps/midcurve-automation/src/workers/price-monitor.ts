/**
 * Price Monitor Worker
 *
 * Polls pool prices for pools with active close orders.
 * Publishes trigger events to RabbitMQ when price conditions are met.
 */

import { getPoolSubscriptionService, getCloseOrderService, getUniswapV3PoolService } from '../lib/services';
import { readPoolPrice, type SupportedChainId } from '../lib/evm';
import { isSupportedChain, getWorkerConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology';
import { serializeMessage, type OrderTriggerMessage } from '../mq/messages';

const log = automationLogger.child({ component: 'PriceMonitor' });

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
   */
  private async checkTrigger(
    orderId: string,
    positionId: string,
    poolAddress: string,
    chainId: number,
    currentPrice: bigint,
    config: { sqrtPriceX96Lower: bigint; sqrtPriceX96Upper: bigint }
  ): Promise<boolean> {
    const { sqrtPriceX96Lower, sqrtPriceX96Upper } = config;

    let triggerSide: 'lower' | 'upper' | null = null;
    let triggerPrice: bigint | null = null;

    // Check lower bound (price dropped below range)
    // Only trigger if lower bound is set (> 0)
    if (sqrtPriceX96Lower > 0n && currentPrice <= sqrtPriceX96Lower) {
      triggerSide = 'lower';
      triggerPrice = sqrtPriceX96Lower;
    }
    // Check upper bound (price rose above range)
    // Only trigger if upper bound is set (> 0)
    else if (sqrtPriceX96Upper > 0n && currentPrice >= sqrtPriceX96Upper) {
      triggerSide = 'upper';
      triggerPrice = sqrtPriceX96Upper;
    }

    if (!triggerSide || !triggerPrice) {
      return false;
    }

    // Log trigger
    autoLog.orderTriggered(
      log,
      orderId,
      positionId,
      poolAddress,
      currentPrice.toString(),
      triggerPrice.toString()
    );

    // Publish trigger message
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
