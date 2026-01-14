/**
 * Uniswap V3 OHLC Data Worker
 *
 * Manages WebSocket subscriptions to Uniswap V3 Swap events,
 * aggregates data into 1-minute OHLC candles, and publishes
 * completed candles to RabbitMQ.
 */

import { automationLogger, autoLog } from '../../../lib/logger';
import { getWebSocketClient, isWebSocketAvailable } from '../../../lib/evm-websocket';
import { readPoolPrice, type SupportedChainId } from '../../../lib/evm';
import { isSupportedChain } from '../../../lib/config';
import { getRabbitMQConnection } from '../../../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../../../mq/topology';
import { serializeMessage } from '../../../mq/messages';
import { getPoolKey, getMinuteBoundary } from '../../../types/ohlc';
import type {
  UniswapV3OhlcCandle,
  UniswapV3SwapEventData,
  UniswapV3OhlcPoolSubscription,
} from '../../../types/ohlc-uniswapv3';
import { UNISWAP_V3_SWAP_EVENT_ABI } from '../../../types/ohlc-uniswapv3';
import {
  createCandleBuilder,
  processSwapEvent,
  finalizeCandle,
  startNewCandle,
} from './candle-builder';

const log = automationLogger.child({ component: 'UniswapV3OhlcWorker' });

// =============================================================================
// Types
// =============================================================================

export interface UniswapV3OhlcWorkerStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  poolsSubscribed: number;
  candlesPublished: number;
  lastPublishAt: string | null;
}

// =============================================================================
// Worker
// =============================================================================

export class UniswapV3OhlcWorker {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private subscriptions = new Map<string, UniswapV3OhlcPoolSubscription>();
  private minuteTimer: NodeJS.Timeout | null = null;
  private candlesPublished = 0;
  private lastPublishAt: Date | null = null;

  /**
   * Start the OHLC data worker
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'UniswapV3OhlcWorker already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'UniswapV3OhlcWorker', 'starting');
    this.status = 'running';

    // Start self-correcting minute boundary timer
    this.scheduleNextMinuteTick();

    autoLog.workerLifecycle(log, 'UniswapV3OhlcWorker', 'started');
  }

  /**
   * Stop the OHLC data worker
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'UniswapV3OhlcWorker', 'stopping');
    this.status = 'stopping';

    // Stop minute timer
    if (this.minuteTimer) {
      clearTimeout(this.minuteTimer);
      this.minuteTimer = null;
    }

    // Unsubscribe from all pools (publishes final candles)
    const poolKeys = Array.from(this.subscriptions.keys());
    for (const poolKey of poolKeys) {
      const subscription = this.subscriptions.get(poolKey);
      if (subscription) {
        await this.unsubscribePool(subscription.chainId, subscription.poolAddress);
      }
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'UniswapV3OhlcWorker', 'stopped');
  }

  /**
   * Subscribe to a pool's swap events
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   * @returns true if subscription successful
   */
  async subscribePool(chainId: number, poolAddress: string): Promise<boolean> {
    const poolKey = getPoolKey(chainId, poolAddress);

    if (this.subscriptions.has(poolKey)) {
      log.debug({ chainId, poolAddress, msg: 'Already subscribed to pool' });
      return true;
    }

    if (!isSupportedChain(chainId)) {
      log.warn({ chainId, poolAddress, msg: 'Unsupported chain for OHLC' });
      return false;
    }

    if (!isWebSocketAvailable(chainId)) {
      log.warn({ chainId, poolAddress, msg: 'WebSocket not available for chain' });
      return false;
    }

    const wsClient = getWebSocketClient(chainId as SupportedChainId);
    if (!wsClient) {
      log.error({ chainId, poolAddress, msg: 'Failed to get WebSocket client' });
      return false;
    }

    // Get initial price from chain
    let initialPrice: bigint;
    try {
      const { sqrtPriceX96 } = await readPoolPrice(
        chainId as SupportedChainId,
        poolAddress as `0x${string}`
      );
      initialPrice = sqrtPriceX96;
    } catch (err) {
      log.error({ chainId, poolAddress, error: err, msg: 'Failed to read initial price' });
      return false;
    }

    // Create candle builder
    const candleBuilder = createCandleBuilder(chainId, poolAddress, initialPrice);

    // Subscribe to Swap events
    const unwatch = wsClient.watchContractEvent({
      address: poolAddress as `0x${string}`,
      abi: UNISWAP_V3_SWAP_EVENT_ABI,
      eventName: 'Swap',
      onLogs: (logs) => this.handleSwapLogs(chainId, poolAddress, logs),
      onError: (error) => this.handleSubscriptionError(chainId, poolAddress, error),
    });

    // Store subscription
    this.subscriptions.set(poolKey, {
      chainId,
      poolAddress,
      unwatch,
      candleBuilder,
    });

    log.info({
      chainId,
      poolAddress,
      initialPrice: initialPrice.toString(),
      msg: 'Subscribed to pool Swap events',
    });

    return true;
  }

  /**
   * Unsubscribe from a pool's swap events
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   */
  async unsubscribePool(chainId: number, poolAddress: string): Promise<void> {
    const poolKey = getPoolKey(chainId, poolAddress);
    const subscription = this.subscriptions.get(poolKey);

    if (!subscription) {
      return;
    }

    // Publish final candle if we have data
    if (subscription.candleBuilder.hasData) {
      const finalCandle = finalizeCandle(subscription.candleBuilder);
      await this.publishCandle(finalCandle);
    }

    // Stop watching
    subscription.unwatch();
    this.subscriptions.delete(poolKey);

    log.info({ chainId, poolAddress, msg: 'Unsubscribed from pool' });
  }

  /**
   * Get current status
   */
  getStatus(): UniswapV3OhlcWorkerStatus {
    return {
      status: this.status,
      poolsSubscribed: this.subscriptions.size,
      candlesPublished: this.candlesPublished,
      lastPublishAt: this.lastPublishAt?.toISOString() || null,
    };
  }

  /**
   * Get list of subscribed pools
   */
  getSubscribedPools(): Array<{ chainId: number; poolAddress: string }> {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      chainId: sub.chainId,
      poolAddress: sub.poolAddress,
    }));
  }

  /**
   * Get subscribed pool count by chain
   */
  getSubscriptionCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const sub of this.subscriptions.values()) {
      counts[sub.chainId] = (counts[sub.chainId] || 0) + 1;
    }
    return counts;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle incoming Swap event logs
   */
  private handleSwapLogs(chainId: number, poolAddress: string, logs: unknown[]): void {
    const poolKey = getPoolKey(chainId, poolAddress);
    const subscription = this.subscriptions.get(poolKey);
    if (!subscription) return;

    const eventTimestampMs = Date.now();

    for (const rawLog of logs) {
      try {
        // Type assertion for viem log structure
        const logData = rawLog as {
          args: {
            sender: string;
            recipient: string;
            amount0: bigint;
            amount1: bigint;
            sqrtPriceX96: bigint;
            liquidity: bigint;
            tick: number;
          };
          transactionHash: string;
          blockNumber: bigint;
        };

        const event: UniswapV3SwapEventData = {
          sender: logData.args.sender,
          recipient: logData.args.recipient,
          amount0: logData.args.amount0,
          amount1: logData.args.amount1,
          sqrtPriceX96: logData.args.sqrtPriceX96,
          liquidity: logData.args.liquidity,
          tick: logData.args.tick,
          transactionHash: logData.transactionHash,
          blockNumber: logData.blockNumber,
        };

        const { builder, completedCandle } = processSwapEvent(
          subscription.candleBuilder,
          event,
          eventTimestampMs
        );

        // Update builder
        subscription.candleBuilder = builder;

        // Publish completed candle if minute boundary crossed
        if (completedCandle) {
          this.publishCandle(completedCandle).catch((err) => {
            log.error({ chainId, poolAddress, error: err, msg: 'Failed to publish candle' });
          });
        }
      } catch (err) {
        log.error({ chainId, poolAddress, error: err, msg: 'Failed to process swap event' });
      }
    }
  }

  /**
   * Handle subscription error
   */
  private handleSubscriptionError(chainId: number, poolAddress: string, error: Error): void {
    log.error({
      chainId,
      poolAddress,
      error: error.message,
      msg: 'WebSocket subscription error',
    });

    // Attempt to resubscribe after delay
    setTimeout(() => {
      if (this.status === 'running') {
        log.info({ chainId, poolAddress, msg: 'Attempting to resubscribe after error' });
        this.subscribePool(chainId, poolAddress).catch((err) => {
          log.error({ chainId, poolAddress, error: err, msg: 'Failed to resubscribe' });
        });
      }
    }, 5000);
  }

  /**
   * Schedule next minute boundary tick (self-correcting)
   *
   * Recalculates delay each time to prevent drift.
   */
  private scheduleNextMinuteTick(): void {
    if (this.status !== 'running') return;

    const now = Date.now();
    const currentMinuteMs = getMinuteBoundary(now);
    const nextMinuteMs = currentMinuteMs + 60000;
    const delay = nextMinuteMs - now;

    this.minuteTimer = setTimeout(() => {
      this.onMinuteBoundary();
      this.scheduleNextMinuteTick(); // Reschedule from fresh time
    }, delay);

    log.debug({
      delayMs: delay,
      nextMinute: new Date(nextMinuteMs).toISOString(),
      msg: 'Scheduled next minute tick',
    });
  }

  /**
   * Handle minute boundary - finalize and publish all candles
   */
  private onMinuteBoundary(): void {
    const now = Date.now();
    const currentMinuteMs = getMinuteBoundary(now);

    for (const [poolKey, subscription] of this.subscriptions) {
      const { candleBuilder } = subscription;

      // Check if candle is from a previous minute
      if (candleBuilder.currentMinuteMs < currentMinuteMs) {
        // Publish candle if we have data
        if (candleBuilder.hasData) {
          const candle = finalizeCandle(candleBuilder);
          this.publishCandle(candle).catch((err) => {
            log.error({ poolKey, error: err, msg: 'Failed to publish candle on timer' });
          });
        }

        // Start new candle with continuity
        subscription.candleBuilder = startNewCandle(candleBuilder, currentMinuteMs);
      }
    }
  }

  /**
   * Publish a completed candle to RabbitMQ
   */
  private async publishCandle(candle: UniswapV3OhlcCandle): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(candle);

    await mq.publish(EXCHANGES.OHLC_UNISWAPV3, ROUTING_KEYS.OHLC_UNISWAPV3_1M, content);

    this.candlesPublished++;
    this.lastPublishAt = new Date();

    log.debug({
      chainId: candle.chainId,
      poolAddress: candle.poolAddress,
      timestamp: candle.timestamp,
      swapCount: candle.swapCount,
      msg: 'Published OHLC candle',
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let workerInstance: UniswapV3OhlcWorker | null = null;

/**
 * Get the singleton worker instance
 */
export function getUniswapV3OhlcWorker(): UniswapV3OhlcWorker {
  if (!workerInstance) {
    workerInstance = new UniswapV3OhlcWorker();
  }
  return workerInstance;
}
