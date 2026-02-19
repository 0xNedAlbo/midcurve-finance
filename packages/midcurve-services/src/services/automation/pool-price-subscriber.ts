/**
 * Pool Price Subscriber
 *
 * Subscribes to pool price events from RabbitMQ's pool-prices exchange.
 * Consumes messages for a specific pool identified by chainId and poolAddress.
 *
 * Pure MQ consumer — no database dependency. Used by automation workers
 * (CloseOrderMonitor, RangeMonitor) to receive Swap events.
 */

import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { createServiceLogger, LogPatterns } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  RabbitMQConfig,
  RawSwapEventWrapper,
  PoolPriceSubscriberOptions,
  PoolPriceSubscriberState,
  PoolPriceSubscriberStatus,
  PoolPriceMessageHandler,
  PoolPriceErrorHandler,
} from './pool-price-subscriber.types.js';

// ============================================================================
// RabbitMQ Constants & Helpers
// ============================================================================

/**
 * Pool prices exchange name.
 * Must match the exchange created by midcurve-onchain-data.
 */
export const EXCHANGE_POOL_PRICES = 'pool-prices';

/**
 * Build routing key for UniswapV3 pool price events.
 * Format: uniswapv3.{chainId}.{poolAddress}
 */
export function buildPoolPriceRoutingKey(chainId: number, poolAddress: string): string {
  return `uniswapv3.${chainId}.${poolAddress.toLowerCase()}`;
}

/**
 * Build unique queue name for a pool price subscriber.
 * Auto-deletes when consumer disconnects. Uses timestamp for uniqueness.
 */
function buildSubscriberQueueName(chainId: number, poolAddress: string): string {
  const uniqueId = Date.now().toString(36);
  const shortAddress = poolAddress.toLowerCase().slice(0, 10);
  return `pool-price-sub.${chainId}.${shortAddress}.${uniqueId}`;
}

/**
 * Get RabbitMQ configuration from environment variables.
 */
function getRabbitMQConfig(): RabbitMQConfig {
  return {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USER || 'midcurve',
    password: process.env.RABBITMQ_PASS || 'midcurve_dev',
    vhost: process.env.RABBITMQ_VHOST,
  };
}

/**
 * Build AMQP connection URL from configuration.
 */
function buildConnectionUrl(config: RabbitMQConfig): string {
  const encodedUser = encodeURIComponent(config.username);
  const encodedPass = encodeURIComponent(config.password);
  const vhost = config.vhost ? `/${encodeURIComponent(config.vhost)}` : '';
  return `amqp://${encodedUser}:${encodedPass}@${config.host}:${config.port}${vhost}`;
}

// ============================================================================
// PoolPriceSubscriber Class
// ============================================================================

/**
 * PoolPriceSubscriber - Subscribes to pool price events from RabbitMQ.
 *
 * Connects to the pool-prices topic exchange and consumes messages
 * for a specific pool identified by chainId and poolAddress.
 */
export class PoolPriceSubscriber {
  // Configuration
  private readonly subscriberId: string;
  private readonly chainId: number;
  private readonly poolAddress: string;
  private readonly routingKey: string;
  private readonly queueName: string;
  private readonly messageHandler: PoolPriceMessageHandler;
  private readonly errorHandler?: PoolPriceErrorHandler;
  private readonly prefetch: number;

  // Connection management
  private readonly ownsConnection: boolean;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private consumerTag: string | null = null;

  // State tracking
  private state: PoolPriceSubscriberState = 'idle';
  private messagesReceived = 0;
  private lastMessageAt: Date | null = null;
  private startedAt: Date | null = null;

  // Logging
  private readonly logger: ServiceLogger;

  constructor(options: PoolPriceSubscriberOptions) {
    this.subscriberId = options.subscriberId;
    this.chainId = options.chainId;
    this.poolAddress = options.poolAddress.toLowerCase();
    this.messageHandler = options.messageHandler;
    this.errorHandler = options.errorHandler;
    this.prefetch = options.prefetch ?? 1;

    // Build routing key and queue name
    this.routingKey = buildPoolPriceRoutingKey(this.chainId, this.poolAddress);
    this.queueName = buildSubscriberQueueName(this.chainId, this.poolAddress);

    // Handle connection ownership
    if (options.connection) {
      this.connection = options.connection;
      this.ownsConnection = false;
    } else {
      this.ownsConnection = true;
    }

    // Logger
    this.logger = options.logger ?? createServiceLogger('PoolPriceSubscriber');

    this.logger.debug(
      {
        subscriberId: this.subscriberId,
        chainId: this.chainId,
        poolAddress: this.poolAddress,
        routingKey: this.routingKey,
        queueName: this.queueName,
        ownsConnection: this.ownsConnection,
      },
      'Subscriber created'
    );
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Start the subscriber.
   *
   * Connects to RabbitMQ (if needed), creates an exclusive queue,
   * binds to the pool-prices exchange, and starts consuming.
   *
   * @throws Error if already started (subscribers can only be started once)
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(
        `Cannot start subscriber: already in state '${this.state}'. ` +
          `Subscribers can only be started once. Create a new instance if needed.`
      );
    }

    this.state = 'starting';
    LogPatterns.methodEntry(this.logger, 'start', {
      chainId: this.chainId,
      poolAddress: this.poolAddress,
    });

    try {
      // 1. Establish connection if we don't have one
      if (!this.connection) {
        await this.connect();
      }

      // 2. Create channel
      this.channel = await this.connection!.createChannel();
      this.setupChannelListeners();

      // 3. Set prefetch for fair dispatch
      await this.channel.prefetch(this.prefetch);

      // 4. Create queue (non-exclusive to allow cleanup, auto-deletes when consumer disconnects)
      await this.channel.assertQueue(this.queueName, {
        exclusive: false,
        autoDelete: true,
        durable: false,
      });

      this.logger.debug({ queueName: this.queueName }, 'Queue declared');

      // 5. Bind queue to pool-prices exchange with routing key
      await this.channel.bindQueue(this.queueName, EXCHANGE_POOL_PRICES, this.routingKey);

      this.logger.debug(
        { exchange: EXCHANGE_POOL_PRICES, routingKey: this.routingKey },
        'Queue bound to exchange'
      );

      // 6. Start consuming
      const result = await this.channel.consume(
        this.queueName,
        (msg) => this.onMessage(msg),
        { noAck: false }
      );

      this.consumerTag = result.consumerTag;
      this.state = 'running';
      this.startedAt = new Date();

      this.logger.info(
        {
          chainId: this.chainId,
          poolAddress: this.poolAddress,
          routingKey: this.routingKey,
          queueName: this.queueName,
          consumerTag: this.consumerTag,
        },
        'Subscriber started'
      );

      LogPatterns.methodExit(this.logger, 'start');
    } catch (error) {
      this.state = 'error';
      LogPatterns.methodError(this.logger, 'start', error as Error, {
        chainId: this.chainId,
        poolAddress: this.poolAddress,
      });
      throw error;
    }
  }

  /**
   * Gracefully shutdown the subscriber.
   */
  async shutdown(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      this.logger.debug({ state: this.state }, 'Subscriber not running, nothing to shutdown');
      return;
    }

    this.state = 'stopping';
    LogPatterns.methodEntry(this.logger, 'shutdown');

    try {
      // 1. Cancel consumer
      if (this.channel && this.consumerTag) {
        try {
          await this.channel.cancel(this.consumerTag);
          this.logger.debug({ consumerTag: this.consumerTag }, 'Consumer cancelled');
        } catch (err) {
          this.logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            'Error cancelling consumer'
          );
        }
      }

      // 2. Close channel
      if (this.channel) {
        try {
          await this.channel.close();
          this.logger.debug({}, 'Channel closed');
        } catch (err) {
          this.logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            'Error closing channel'
          );
        }
        this.channel = null;
      }

      // 3. Close connection (only if we own it)
      if (this.ownsConnection && this.connection) {
        try {
          await this.connection.close();
          this.logger.debug({}, 'Connection closed');
        } catch (err) {
          this.logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            'Error closing connection'
          );
        }
        this.connection = null;
      }

      this.state = 'stopped';
      this.consumerTag = null;

      this.logger.info(
        {
          chainId: this.chainId,
          poolAddress: this.poolAddress,
          messagesReceived: this.messagesReceived,
        },
        'Subscriber stopped'
      );

      LogPatterns.methodExit(this.logger, 'shutdown');
    } catch (error) {
      this.state = 'error';
      LogPatterns.methodError(this.logger, 'shutdown', error as Error);
      throw error;
    }
  }

  /**
   * Get subscriber status information.
   */
  getStatus(): PoolPriceSubscriberStatus {
    return {
      state: this.state,
      chainId: this.chainId,
      poolAddress: this.poolAddress,
      routingKey: this.routingKey,
      queueName: this.queueName,
      messagesReceived: this.messagesReceived,
      lastMessageAt: this.lastMessageAt,
      startedAt: this.startedAt,
      consumerTag: this.consumerTag,
    };
  }

  /**
   * Check if subscriber is currently running.
   */
  isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Get the queue name.
   */
  getQueueName(): string {
    return this.queueName;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async connect(): Promise<void> {
    const config = getRabbitMQConfig();
    const url = buildConnectionUrl(config);

    this.logger.debug({ host: config.host, port: config.port }, 'Connecting to RabbitMQ');

    this.connection = await amqplib.connect(url);
    this.setupConnectionListeners();

    this.logger.debug({}, 'Connected to RabbitMQ');
  }

  private setupConnectionListeners(): void {
    if (!this.connection) return;

    this.connection.on('error', (err) => {
      this.logger.error({ error: err.message }, 'RabbitMQ connection error');
      this.handleConnectionError(err);
    });

    this.connection.on('close', () => {
      if (this.state === 'running') {
        this.logger.warn({}, 'RabbitMQ connection closed unexpectedly');
        this.handleConnectionError(new Error('Connection closed unexpectedly'));
      }
    });
  }

  private setupChannelListeners(): void {
    if (!this.channel) return;

    this.channel.on('error', (err) => {
      this.logger.error({ error: err.message }, 'RabbitMQ channel error');
      this.handleConnectionError(err);
    });

    this.channel.on('close', () => {
      if (this.state === 'running') {
        this.logger.warn({}, 'RabbitMQ channel closed unexpectedly');
        this.handleConnectionError(new Error('Channel closed unexpectedly'));
      }
    });
  }

  private handleConnectionError(error: Error): void {
    this.state = 'error';

    if (this.errorHandler) {
      try {
        const result = this.errorHandler(error, this);
        if (result instanceof Promise) {
          result.catch((err) => {
            this.logger.error(
              { error: err instanceof Error ? err.message : String(err) },
              'Error in errorHandler'
            );
          });
        }
      } catch (err) {
        this.logger.error(
          { error: err instanceof Error ? (err as Error).message : String(err) },
          'Error in errorHandler'
        );
      }
    }
  }

  private async onMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    try {
      const content = msg.content.toString();
      const message = JSON.parse(content) as RawSwapEventWrapper;

      this.messagesReceived++;
      this.lastMessageAt = new Date();

      this.logger.debug(
        {
          chainId: message.chainId,
          poolAddress: message.poolAddress,
          receivedAt: message.receivedAt,
          messagesReceived: this.messagesReceived,
        },
        'Message received'
      );

      await this.messageHandler(message, this);

      if (this.channel) {
        this.channel.ack(msg);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error({ error: errorMessage }, 'Error processing message');

      if (this.channel) {
        this.channel.nack(msg, false, false);
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new pool price subscriber instance.
 */
export function createPoolPriceSubscriber(
  options: PoolPriceSubscriberOptions
): PoolPriceSubscriber {
  return new PoolPriceSubscriber(options);
}
