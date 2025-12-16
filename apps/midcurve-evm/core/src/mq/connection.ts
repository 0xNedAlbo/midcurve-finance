/**
 * RabbitMQ Connection Manager
 *
 * Manages a singleton connection and channel for the EVM Core API.
 */

import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import { logger, evmLog } from '../../../lib/logger';
import { setupCoreTopology } from './topology';

// =============================================================================
// Types
// =============================================================================

interface RabbitMQConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost?: string;
}

// =============================================================================
// Connection Manager
// =============================================================================

class RabbitMQConnectionManager {
  private readonly log = logger.child({ component: 'RabbitMQConnection' });
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connecting: Promise<Channel> | null = null;

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
   * Connect to RabbitMQ and setup core topology.
   */
  private async connect(): Promise<Channel> {
    evmLog.methodEntry(this.log, 'connect');

    const config = this.getConfig();
    const url = `amqp://${config.username}:${config.password}@${config.host}:${config.port}${config.vhost ? `/${config.vhost}` : ''}`;

    this.log.info({ host: config.host, port: config.port, msg: 'Connecting to RabbitMQ' });

    this.connection = await amqplib.connect(url);

    this.connection.on('error', (err) => {
      this.log.error({ error: err, msg: 'RabbitMQ connection error' });
      this.cleanup();
    });

    this.connection.on('close', () => {
      this.log.warn({ msg: 'RabbitMQ connection closed' });
      this.cleanup();
    });

    this.channel = await this.connection.createChannel();

    this.channel.on('error', (err) => {
      this.log.error({ error: err, msg: 'RabbitMQ channel error' });
      this.cleanup();
    });

    this.channel.on('close', () => {
      this.log.warn({ msg: 'RabbitMQ channel closed' });
      this.channel = null;
    });

    // Setup core topology
    await setupCoreTopology(this.channel);

    this.log.info({ msg: 'RabbitMQ connected and core topology ready' });
    evmLog.methodExit(this.log, 'connect');

    return this.channel;
  }

  /**
   * Get configuration from environment.
   */
  private getConfig(): RabbitMQConfig {
    return {
      host: process.env.RABBITMQ_HOST || 'localhost',
      port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
      username: process.env.RABBITMQ_USER || 'midcurve',
      password: process.env.RABBITMQ_PASS || 'midcurve_dev',
      vhost: process.env.RABBITMQ_VHOST,
    };
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
    evmLog.methodEntry(this.log, 'close');

    if (this.channel) {
      try {
        await this.channel.close();
      } catch (err) {
        this.log.warn({ error: err, msg: 'Error closing channel' });
      }
      this.channel = null;
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch (err) {
        this.log.warn({ error: err, msg: 'Error closing connection' });
      }
      this.connection = null;
    }

    evmLog.methodExit(this.log, 'close');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let connectionManagerInstance: RabbitMQConnectionManager | null = null;

export function getRabbitMQConnection(): RabbitMQConnectionManager {
  if (!connectionManagerInstance) {
    connectionManagerInstance = new RabbitMQConnectionManager();
  }
  return connectionManagerInstance;
}

export { RabbitMQConnectionManager };
