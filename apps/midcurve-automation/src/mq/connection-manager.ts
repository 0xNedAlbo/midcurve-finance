/**
 * RabbitMQ Connection Manager
 *
 * Manages a singleton connection and channel for the automation service.
 */

import amqplib, { type ChannelModel, type Channel, type ConsumeMessage } from 'amqplib';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConfig, type RabbitMQConfig } from '../lib/config';
import { setupAutomationTopology } from './topology';

// Re-export ConsumeMessage for consumers
export type { ConsumeMessage } from 'amqplib';

const log = automationLogger.child({ component: 'RabbitMQConnection' });

// =============================================================================
// Connection Manager
// =============================================================================

class RabbitMQConnectionManager {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connecting: Promise<Channel> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  /**
   * Get the RabbitMQ channel, connecting if necessary.
   */
  async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    // If already connecting, wait for it
    if (this.connecting) {
      return this.connecting;
    }

    // Start new connection
    this.connecting = this.connect();

    try {
      const channel = await this.connecting;
      return channel;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.channel !== null;
  }

  /**
   * Connect to RabbitMQ and setup automation topology.
   */
  async connect(): Promise<Channel> {
    autoLog.methodEntry(log, 'connect');

    const config = getRabbitMQConfig();
    const url = this.buildUrl(config);

    log.info({ host: config.host, port: config.port, msg: 'Connecting to RabbitMQ' });

    try {
      this.connection = await amqplib.connect(url);
      this.reconnectAttempts = 0;

      this.connection.on('error', (err) => {
        log.error({ error: err.message, msg: 'RabbitMQ connection error' });
        this.handleDisconnect();
      });

      this.connection.on('close', () => {
        log.warn({ msg: 'RabbitMQ connection closed' });
        this.handleDisconnect();
      });

      this.channel = await this.connection.createChannel();

      this.channel.on('error', (err) => {
        log.error({ error: err.message, msg: 'RabbitMQ channel error' });
        this.channel = null;
      });

      this.channel.on('close', () => {
        log.warn({ msg: 'RabbitMQ channel closed' });
        this.channel = null;
      });

      // Setup automation topology
      await setupAutomationTopology(this.channel);

      log.info({ msg: 'RabbitMQ connected, automation topology ready' });
      autoLog.methodExit(log, 'connect');

      return this.channel;
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err), msg: 'Failed to connect to RabbitMQ' });
      throw err;
    }
  }

  /**
   * Build connection URL from config
   */
  private buildUrl(config: RabbitMQConfig): string {
    const vhost = config.vhost ? `/${config.vhost}` : '';
    return `amqp://${config.username}:${config.password}@${config.host}:${config.port}${vhost}`;
  }

  /**
   * Handle disconnection with auto-reconnect
   */
  private handleDisconnect(): void {
    this.cleanup();

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      log.info({
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delayMs: this.reconnectDelayMs,
        msg: 'Scheduling reconnect',
      });

      setTimeout(() => {
        this.getChannel().catch((err) => {
          log.error({ error: err.message, msg: 'Reconnect failed' });
        });
      }, this.reconnectDelayMs);
    } else {
      log.error({ msg: 'Max reconnect attempts reached, giving up' });
    }
  }

  /**
   * Cleanup connection and channel.
   */
  private cleanup(): void {
    this.channel = null;
    this.connection = null;
  }

  /**
   * Close connection gracefully.
   */
  async close(): Promise<void> {
    autoLog.methodEntry(log, 'close');

    if (this.channel) {
      try {
        await this.channel.close();
      } catch (err) {
        log.warn({ error: err instanceof Error ? err.message : String(err), msg: 'Error closing channel' });
      }
      this.channel = null;
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch (err) {
        log.warn({ error: err instanceof Error ? err.message : String(err), msg: 'Error closing connection' });
      }
      this.connection = null;
    }

    autoLog.methodExit(log, 'close');
  }

  /**
   * Publish a message to an exchange
   */
  async publish(exchange: string, routingKey: string, content: Buffer): Promise<boolean> {
    const channel = await this.getChannel();
    return channel.publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  /**
   * Publish a message directly to a queue (bypassing exchange)
   */
  async publishToQueue(queue: string, content: Buffer): Promise<boolean> {
    const channel = await this.getChannel();
    return channel.sendToQueue(queue, content, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  /**
   * Consume messages from a queue
   */
  async consume(
    queue: string,
    handler: (msg: ConsumeMessage | null) => Promise<void>,
    options: { prefetch?: number } = {}
  ): Promise<string> {
    const channel = await this.getChannel();

    // Set prefetch if specified
    if (options.prefetch !== undefined) {
      await channel.prefetch(options.prefetch);
    }

    const { consumerTag } = await channel.consume(queue, (msg) => {
      handler(msg).catch((err) => {
        log.error({ error: err.message, queue, msg: 'Consumer handler error' });
      });
    });

    log.info({ queue, consumerTag, msg: 'Consumer started' });
    return consumerTag;
  }

  /**
   * Cancel a consumer
   */
  async cancelConsumer(consumerTag: string): Promise<void> {
    const channel = await this.getChannel();
    await channel.cancel(consumerTag);
    log.info({ consumerTag, msg: 'Consumer cancelled' });
  }

  /**
   * Acknowledge a message
   */
  async ack(msg: ConsumeMessage): Promise<void> {
    const channel = await this.getChannel();
    channel.ack(msg);
  }

  /**
   * Negative acknowledge a message
   */
  async nack(msg: ConsumeMessage, requeue: boolean = true): Promise<void> {
    const channel = await this.getChannel();
    channel.nack(msg, false, requeue);
  }
}

// =============================================================================
// Singleton (survives Next.js HMR in development)
// =============================================================================

// Use globalThis to prevent singleton from being reset during Hot Module Reloading
const globalForRabbitMQ = globalThis as unknown as {
  automationRabbitMQ: RabbitMQConnectionManager | undefined;
};

export function getRabbitMQConnection(): RabbitMQConnectionManager {
  if (!globalForRabbitMQ.automationRabbitMQ) {
    globalForRabbitMQ.automationRabbitMQ = new RabbitMQConnectionManager();
  }
  return globalForRabbitMQ.automationRabbitMQ;
}

export { RabbitMQConnectionManager };
