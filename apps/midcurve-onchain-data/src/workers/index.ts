/**
 * WorkerManager
 *
 * Coordinates workers and services for the onchain data service.
 * Manages lifecycle: start, stop, and status reporting.
 *
 * Workers:
 * - PoolPriceSubscriber: Subscribes to Swap events from Uniswap V3 pools
 * - PositionLiquiditySubscriber: Subscribes to position events from NFPM
 */

import { onchainDataLogger, priceLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { PoolPriceSubscriber } from './pool-price-subscriber';
import { PositionLiquiditySubscriber } from './position-liquidity-subscriber';

const log = onchainDataLogger.child({ component: 'WorkerManager' });

/**
 * WorkerManager coordinates all workers and services.
 */
export class WorkerManager {
  private poolPriceSubscriber: PoolPriceSubscriber;
  private positionLiquiditySubscriber: PositionLiquiditySubscriber;
  private isRunning = false;

  constructor() {
    this.poolPriceSubscriber = new PoolPriceSubscriber();
    this.positionLiquiditySubscriber = new PositionLiquiditySubscriber();
  }

  /**
   * Start the worker manager.
   * Connects to RabbitMQ and starts all workers.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'WorkerManager already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'WorkerManager', 'starting');

    try {
      // Connect to RabbitMQ first (this also sets up topology for both exchanges)
      log.info({ msg: 'Connecting to RabbitMQ...' });
      const mq = getRabbitMQConnection();
      await mq.getChannel();

      // Start both subscribers in parallel
      log.info({ msg: 'Starting subscribers...' });
      await Promise.all([
        this.poolPriceSubscriber.start(),
        this.positionLiquiditySubscriber.start(),
      ]);

      this.isRunning = true;
      priceLog.workerLifecycle(log, 'WorkerManager', 'started');
    } catch (error) {
      priceLog.workerLifecycle(log, 'WorkerManager', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the worker manager.
   * Gracefully stops all workers and disconnects from services.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'WorkerManager not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'WorkerManager', 'stopping');

    try {
      // Stop both subscribers in parallel
      log.info({ msg: 'Stopping subscribers...' });
      await Promise.all([
        this.poolPriceSubscriber.stop(),
        this.positionLiquiditySubscriber.stop(),
      ]);

      // Close RabbitMQ connection
      log.info({ msg: 'Closing RabbitMQ connection...' });
      const mq = getRabbitMQConnection();
      await mq.close();

      this.isRunning = false;
      priceLog.workerLifecycle(log, 'WorkerManager', 'stopped');
    } catch (error) {
      priceLog.workerLifecycle(log, 'WorkerManager', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get the status of the worker manager and all workers.
   */
  getStatus(): {
    isRunning: boolean;
    poolPriceSubscriber: ReturnType<PoolPriceSubscriber['getStatus']>;
    positionLiquiditySubscriber: ReturnType<PositionLiquiditySubscriber['getStatus']>;
    rabbitmq: {
      isConnected: boolean;
    };
  } {
    const mq = getRabbitMQConnection();

    return {
      isRunning: this.isRunning,
      poolPriceSubscriber: this.poolPriceSubscriber.getStatus(),
      positionLiquiditySubscriber: this.positionLiquiditySubscriber.getStatus(),
      rabbitmq: {
        isConnected: mq.isConnected(),
      },
    };
  }

  /**
   * @deprecated Use poolPriceSubscriber instead. Kept for backward compatibility.
   */
  get subscriber(): PoolPriceSubscriber {
    return this.poolPriceSubscriber;
  }
}

/**
 * Export subscribers for direct usage if needed.
 */
export { PoolPriceSubscriber } from './pool-price-subscriber';
export { PositionLiquiditySubscriber } from './position-liquidity-subscriber';
