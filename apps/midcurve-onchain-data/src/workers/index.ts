/**
 * WorkerManager
 *
 * Coordinates workers and services for the onchain data service.
 * Manages lifecycle: start, stop, and status reporting.
 *
 * Workers:
 * - PoolPriceSubscriber: Subscribes to Swap events from Uniswap V3 pools
 * - PositionLiquiditySubscriber: Subscribes to position events from NFPM
 *
 * Event Consumers:
 * - PositionCreatedSubscriptionHandler: Adds new positions to subscriptions
 * - PositionClosedSubscriptionHandler: Removes closed positions from subscriptions
 */

import { onchainDataLogger, priceLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import {
  PositionCreatedSubscriptionHandler,
  PositionClosedSubscriptionHandler,
} from '../events';
import { PoolPriceSubscriber } from './pool-price-subscriber';
import { PositionLiquiditySubscriber } from './position-liquidity-subscriber';

const log = onchainDataLogger.child({ component: 'WorkerManager' });

/**
 * WorkerManager coordinates all workers and services.
 */
export class WorkerManager {
  private poolPriceSubscriber: PoolPriceSubscriber;
  private positionLiquiditySubscriber: PositionLiquiditySubscriber;
  private positionCreatedHandler: PositionCreatedSubscriptionHandler;
  private positionClosedHandler: PositionClosedSubscriptionHandler;
  private isRunning = false;

  constructor() {
    this.poolPriceSubscriber = new PoolPriceSubscriber();
    this.positionLiquiditySubscriber = new PositionLiquiditySubscriber();
    this.positionCreatedHandler = new PositionCreatedSubscriptionHandler();
    this.positionClosedHandler = new PositionClosedSubscriptionHandler();

    // Wire subscriber reference to event handlers
    this.positionCreatedHandler.setSubscriber(this.positionLiquiditySubscriber);
    this.positionClosedHandler.setSubscriber(this.positionLiquiditySubscriber);
  }

  /**
   * Start the worker manager.
   * Connects to RabbitMQ and starts all workers and event consumers.
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
      const channel = await mq.getChannel();

      // Start event consumers BEFORE loading positions
      // This ensures we don't miss any events during startup
      log.info({ msg: 'Starting domain event consumers...' });
      await this.positionCreatedHandler.start(channel);
      await this.positionClosedHandler.start(channel);

      // Start both subscribers in parallel (initial DB load + WebSocket connections)
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
   * Gracefully stops all workers, event consumers, and disconnects from services.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'WorkerManager not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'WorkerManager', 'stopping');

    try {
      // Stop event consumers first
      log.info({ msg: 'Stopping domain event consumers...' });
      await this.positionCreatedHandler.stop();
      await this.positionClosedHandler.stop();

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
    eventConsumers: {
      positionCreated: { isRunning: boolean };
      positionClosed: { isRunning: boolean };
    };
    rabbitmq: {
      isConnected: boolean;
    };
  } {
    const mq = getRabbitMQConnection();

    return {
      isRunning: this.isRunning,
      poolPriceSubscriber: this.poolPriceSubscriber.getStatus(),
      positionLiquiditySubscriber: this.positionLiquiditySubscriber.getStatus(),
      eventConsumers: {
        positionCreated: { isRunning: this.positionCreatedHandler.isRunning() },
        positionClosed: { isRunning: this.positionClosedHandler.isRunning() },
      },
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
