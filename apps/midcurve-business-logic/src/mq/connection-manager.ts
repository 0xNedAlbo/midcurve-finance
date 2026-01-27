/**
 * RabbitMQ Connection Manager
 *
 * Manages a singleton connection and channel for the business logic service.
 * This service consumes events from domain events and onchain data exchanges.
 */

import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import { setupDomainEventsTopology } from '@midcurve/services';
import { businessLogicLogger, ruleLog } from '../lib/logger';
import { getRabbitMQConfig, type RabbitMQConfig } from '../lib/config';

const log = businessLogicLogger.child({ component: 'RabbitMQConnection' });

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
   * Connect to RabbitMQ and setup topology.
   * Includes retry logic for initial connection.
   */
  async connect(): Promise<Channel> {
    ruleLog.methodEntry(log, 'connect');

    const config = getRabbitMQConfig();
    const url = this.buildUrl(config);
    const maxRetries = 10;
    const baseDelayMs = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      log.info({ host: config.host, port: config.port, attempt, maxRetries, msg: 'Connecting to RabbitMQ' });

      try {
        this.connection = await amqplib.connect(url);
        this.reconnectAttempts = 0;

        this.connection.on('error', (err) => {
          ruleLog.mqEvent(log, 'error', { error: err.message });
          this.handleDisconnect();
        });

        this.connection.on('close', () => {
          ruleLog.mqEvent(log, 'disconnected');
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

        // Setup domain events topology (domain-events exchange + DLQ for event consumers)
        // This is needed so rules can subscribe to domain events
        await setupDomainEventsTopology(this.channel);

        ruleLog.mqEvent(log, 'connected');
        ruleLog.methodExit(log, 'connect');

        return this.channel;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (attempt < maxRetries) {
          const delayMs = baseDelayMs * attempt; // Linear backoff
          log.warn({ error: errorMsg, attempt, maxRetries, delayMs, msg: 'Failed to connect to RabbitMQ, retrying...' });
          await this.sleep(delayMs);
        } else {
          log.error({ error: errorMsg, msg: 'Failed to connect to RabbitMQ after max retries' });
          throw err;
        }
      }
    }

    // Should never reach here
    throw new Error('Unexpected: connect loop exited without success');
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build connection URL from config
   */
  private buildUrl(config: RabbitMQConfig): string {
    const vhost = config.vhost ? `/${config.vhost}` : '';
    // URL-encode username and password to handle special characters
    const encodedUser = encodeURIComponent(config.username);
    const encodedPass = encodeURIComponent(config.password);
    return `amqp://${encodedUser}:${encodedPass}@${config.host}:${config.port}${vhost}`;
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
    ruleLog.methodEntry(log, 'close');

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

    ruleLog.methodExit(log, 'close');
  }
}

// =============================================================================
// Singleton
// =============================================================================

// Use globalThis to prevent singleton from being reset during Hot Module Reloading
const globalForRabbitMQ = globalThis as unknown as {
  businessLogicRabbitMQ: RabbitMQConnectionManager | undefined;
};

export function getRabbitMQConnection(): RabbitMQConnectionManager {
  if (!globalForRabbitMQ.businessLogicRabbitMQ) {
    globalForRabbitMQ.businessLogicRabbitMQ = new RabbitMQConnectionManager();
  }
  return globalForRabbitMQ.businessLogicRabbitMQ;
}

export { RabbitMQConnectionManager };
