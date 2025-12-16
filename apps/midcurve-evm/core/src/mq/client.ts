/**
 * RabbitMQ Client Module
 *
 * Manages connection lifecycle and provides channel access for the Core orchestrator.
 * Handles reconnection on connection loss.
 */

import amqp from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';

export interface MQConfig {
  /** AMQP connection URL (e.g., amqp://user:pass@host:port) */
  url: string;
  /** Reconnection delay in milliseconds (default: 5000) */
  reconnectDelay?: number;
}

export class MQClient {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnecting = false;
  private closed = false;

  constructor(private config: MQConfig) {
    this.config.reconnectDelay = config.reconnectDelay ?? 5000;
  }

  /**
   * Connect to RabbitMQ and create a channel.
   */
  async connect(): Promise<void> {
    if (this.connection) {
      return; // Already connected
    }

    this.closed = false;
    this.connection = await amqp.connect(this.config.url);

    // Handle connection close
    this.connection.on('close', () => {
      if (!this.closed) {
        console.error('[MQ] Connection closed unexpectedly');
        this.handleDisconnect();
      }
    });

    // Handle connection errors
    this.connection.on('error', (err) => {
      console.error('[MQ] Connection error:', err.message);
    });

    // Create channel
    this.channel = await this.connection.createChannel();

    // Handle channel close
    this.channel.on('close', () => {
      if (!this.closed) {
        console.error('[MQ] Channel closed unexpectedly');
        this.channel = null;
      }
    });

    // Handle channel errors
    this.channel.on('error', (err) => {
      console.error('[MQ] Channel error:', err.message);
    });

    console.log('[MQ] Connected to RabbitMQ');
  }

  /**
   * Gracefully disconnect from RabbitMQ.
   */
  async disconnect(): Promise<void> {
    this.closed = true;

    if (this.channel) {
      try {
        await this.channel.close();
      } catch {
        // Ignore close errors
      }
      this.channel = null;
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch {
        // Ignore close errors
      }
      this.connection = null;
    }

    console.log('[MQ] Disconnected from RabbitMQ');
  }

  /**
   * Get the current channel.
   * @throws Error if not connected
   */
  getChannel(): Channel {
    if (!this.channel) {
      throw new Error('MQ channel not available. Call connect() first.');
    }
    return this.channel;
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  /**
   * Handle unexpected disconnection with automatic reconnection.
   */
  private async handleDisconnect(): Promise<void> {
    if (this.reconnecting || this.closed) {
      return;
    }

    this.reconnecting = true;
    this.connection = null;
    this.channel = null;

    console.log(
      `[MQ] Reconnecting in ${this.config.reconnectDelay}ms...`
    );

    while (!this.closed) {
      await this.sleep(this.config.reconnectDelay!);

      try {
        await this.connect();
        console.log('[MQ] Reconnected successfully');
        this.reconnecting = false;
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[MQ] Reconnection failed: ${message}`);
        console.log(
          `[MQ] Retrying in ${this.config.reconnectDelay}ms...`
        );
      }
    }

    this.reconnecting = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a default MQ client using environment variables.
 */
export function createDefaultMQClient(): MQClient {
  const host = process.env.RABBITMQ_HOST ?? 'localhost';
  const port = process.env.RABBITMQ_PORT ?? '5672';
  const user = process.env.RABBITMQ_USER ?? 'midcurve';
  const pass = process.env.RABBITMQ_PASS ?? 'midcurve_dev';

  const url = `amqp://${user}:${pass}@${host}:${port}`;

  return new MQClient({ url });
}
