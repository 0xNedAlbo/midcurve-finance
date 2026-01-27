/**
 * Update Position Metrics on Pool Price Rule
 *
 * When a pool price event is received from the onchain-data service,
 * this rule updates the metrics for all active positions in that pool:
 * - currentValue: Position value in quote token
 * - unrealizedPnl: Current value minus cost basis
 *
 * Note: Fee calculations are handled by the position service.
 *
 * Uses per-pool debouncing (2 seconds) to reduce database writes
 * during high-frequency trading periods.
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  calculatePositionValue,
  UniswapV3PoolService,
} from '@midcurve/services';
import { BusinessRule } from './base';

// =============================================================================
// Constants
// =============================================================================

const EXCHANGE_POOL_PRICES = 'pool-prices';
const QUEUE_NAME = 'business-logic.update-position-metrics';
const ROUTING_PATTERN = 'uniswapv3.#';
const DEBOUNCE_MS = 2000; // 2 seconds

// =============================================================================
// Types
// =============================================================================

interface SwapEventArgs {
  sqrtPriceX96: string;
  tick: string;
  liquidity: string;
}

interface RawSwapEvent {
  chainId: number;
  poolAddress: string;
  raw: {
    args: SwapEventArgs;
    blockNumber: string;
  };
  receivedAt: string;
}

interface PendingUpdate {
  chainId: number;
  poolAddress: string;
  sqrtPriceX96: bigint;
  currentTick: number;
  liquidity: bigint;
  timer: NodeJS.Timeout;
}

// =============================================================================
// Rule Implementation
// =============================================================================

/**
 * Updates position metrics when pool price changes.
 *
 * Subscribes to pool price events from the onchain-data service and:
 * 1. Debounces updates per pool (2-second window)
 * 2. Updates pool price in database
 * 3. Recalculates position metrics (value, PnL)
 * 4. Batch updates all affected positions
 *
 * Note: Fee calculations are handled by the position service.
 */
export class UpdatePositionMetricsOnPoolPriceRule extends BusinessRule {
  readonly ruleName = 'update-position-metrics-on-pool-price';
  readonly ruleDescription =
    'Updates position metrics (value, PnL) when pool price changes';

  private consumerTag: string | null = null;
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private poolService: UniswapV3PoolService;

  constructor() {
    super();
    this.poolService = new UniswapV3PoolService();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    // Assert the queue and bind to pool price events
    await this.channel.assertQueue(QUEUE_NAME, {
      durable: true,
      autoDelete: false,
    });
    await this.channel.bindQueue(QUEUE_NAME, EXCHANGE_POOL_PRICES, ROUTING_PATTERN);
    await this.channel.prefetch(100);

    // Start consuming
    const result = await this.channel.consume(
      QUEUE_NAME,
      (msg) => this.handleMessage(msg),
      { noAck: false }
    );

    this.consumerTag = result.consumerTag;
    this.logger.info(
      { queueName: QUEUE_NAME, routingPattern: ROUTING_PATTERN },
      'Subscribed to pool price events'
    );
  }

  protected async onShutdown(): Promise<void> {
    // Clear all pending timers
    for (const pending of this.pendingUpdates.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingUpdates.clear();

    // Cancel consumer
    if (this.consumerTag && this.channel) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private handleMessage(msg: ConsumeMessage | null): void {
    if (!msg || !this.channel) return;

    try {
      const event = JSON.parse(msg.content.toString()) as RawSwapEvent;
      this.scheduleUpdate(event);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error parsing swap event'
      );
      this.channel.nack(msg, false, false);
    }
  }

  private scheduleUpdate(event: RawSwapEvent): void {
    const { chainId, poolAddress, raw } = event;
    const key = `${chainId}:${poolAddress.toLowerCase()}`;
    const sqrtPriceX96 = BigInt(raw.args.sqrtPriceX96);
    const currentTick = parseInt(raw.args.tick, 10);
    const liquidity = BigInt(raw.args.liquidity);

    // Clear existing timer for this pool
    const existing = this.pendingUpdates.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Schedule debounced update
    const timer = setTimeout(() => {
      this.processUpdate(key).catch((err) => {
        this.logger.error(
          { error: err instanceof Error ? err.message : String(err), key },
          'Error processing debounced update'
        );
      });
    }, DEBOUNCE_MS);

    this.pendingUpdates.set(key, {
      chainId,
      poolAddress: poolAddress.toLowerCase(),
      sqrtPriceX96,
      currentTick,
      liquidity,
      timer,
    });
  }

  // ===========================================================================
  // Update Processing
  // ===========================================================================

  private async processUpdate(key: string): Promise<void> {
    const pending = this.pendingUpdates.get(key);
    if (!pending) return;
    this.pendingUpdates.delete(key);

    const { chainId, poolAddress, sqrtPriceX96, currentTick } = pending;

    // 1. Find pool by address and chain
    const pool = await this.poolService.findByAddressAndChain(poolAddress, chainId);
    if (!pool) {
      this.logger.debug({ chainId, poolAddress }, 'Pool not found in database');
      return;
    }

    // 2. Update pool price in database
    await this.poolService.setPoolPrice(pool.id, {
      sqrtPriceX96,
      currentTick,
    });

    // 3. Find active positions for this pool
    const positions = await prisma.position.findMany({
      where: { poolId: pool.id, isActive: true },
    });

    if (positions.length === 0) {
      this.logger.debug({ poolId: pool.id }, 'No active positions to update');
      return;
    }

    // 4. Calculate updates for each position (value and PnL only)
    const updates = positions.map((position) => {
      const config = position.config as { tickLower: number; tickUpper: number };
      const state = position.state as { liquidity: string };
      const positionLiquidity = BigInt(state.liquidity);

      // Current value
      const baseIsToken0 = !position.isToken0Quote;
      const currentValue =
        positionLiquidity === 0n
          ? 0n
          : calculatePositionValue(
              positionLiquidity,
              sqrtPriceX96,
              config.tickLower,
              config.tickUpper,
              baseIsToken0
            );

      // Unrealized PnL
      const costBasis = BigInt(position.currentCostBasis);
      const unrealizedPnl = currentValue - costBasis;

      return {
        id: position.id,
        currentValue: currentValue.toString(),
        unrealizedPnl: unrealizedPnl.toString(),
      };
    });

    // 5. Batch update all positions
    await prisma.$transaction(
      updates.map((u) =>
        prisma.position.update({
          where: { id: u.id },
          data: {
            currentValue: u.currentValue,
            unrealizedPnl: u.unrealizedPnl,
          },
        })
      )
    );

    this.logger.debug(
      {
        poolId: pool.id,
        positionCount: positions.length,
        tick: currentTick,
      },
      'Updated position metrics'
    );
  }
}
