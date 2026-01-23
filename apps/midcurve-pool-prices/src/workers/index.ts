/**
 * WorkerManager
 *
 * Coordinates workers and services for the pool prices service.
 * Manages lifecycle: start, stop, and status reporting.
 */

import { poolPricesLogger, priceLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { PoolPriceSubscriber } from './pool-price-subscriber';

const log = poolPricesLogger.child({ component: 'WorkerManager' });

/**
 * WorkerManager coordinates all workers and services.
 */
export class WorkerManager {
  private subscriber: PoolPriceSubscriber;
  private isRunning = false;

  constructor() {
    this.subscriber = new PoolPriceSubscriber();
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
      // Connect to RabbitMQ first (this also sets up topology)
      log.info({ msg: 'Connecting to RabbitMQ...' });
      const mq = getRabbitMQConnection();
      await mq.getChannel();

      // Start the subscriber
      log.info({ msg: 'Starting PoolPriceSubscriber...' });
      await this.subscriber.start();

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
      // Stop the subscriber
      log.info({ msg: 'Stopping PoolPriceSubscriber...' });
      await this.subscriber.stop();

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
    subscriber: ReturnType<PoolPriceSubscriber['getStatus']>;
    rabbitmq: {
      isConnected: boolean;
    };
  } {
    const mq = getRabbitMQConnection();

    return {
      isRunning: this.isRunning,
      subscriber: this.subscriber.getStatus(),
      rabbitmq: {
        isConnected: mq.isConnected(),
      },
    };
  }
}

/**
 * Export the PoolPriceSubscriber for direct usage if needed.
 */
export { PoolPriceSubscriber } from './pool-price-subscriber';
