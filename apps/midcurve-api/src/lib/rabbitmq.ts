/**
 * Lightweight RabbitMQ Connection for API
 *
 * Lazy-initializes a singleton connection for publishing events.
 * Used by the close order confirmation endpoint to publish
 * on-chain events extracted from transaction receipts.
 */

import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import { EXCHANGE_CLOSE_ORDER_EVENTS } from '@midcurve/services';
import { apiLogger } from './logger';

const log = apiLogger.child({ component: 'RabbitMQ' });

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting: Promise<Channel> | null = null;

function buildUrl(): string {
  const host = process.env.RABBITMQ_HOST || 'localhost';
  const port = process.env.RABBITMQ_PORT || '5672';
  const user = encodeURIComponent(process.env.RABBITMQ_USER || 'midcurve');
  const pass = encodeURIComponent(process.env.RABBITMQ_PASS || 'midcurve_dev');
  const vhost = process.env.RABBITMQ_VHOST ? `/${process.env.RABBITMQ_VHOST}` : '';
  return `amqp://${user}:${pass}@${host}:${port}${vhost}`;
}

/**
 * Get a RabbitMQ channel for publishing.
 * Lazily connects on first call; reuses the connection thereafter.
 */
export async function getRabbitMQChannel(): Promise<Channel> {
  if (channel) return channel;

  if (connecting) return connecting;

  connecting = (async () => {
    const url = buildUrl();
    log.info({ msg: 'Connecting to RabbitMQ for event publishing' });

    connection = await amqplib.connect(url);

    connection.on('error', (err) => {
      log.error({ error: err.message, msg: 'RabbitMQ connection error' });
      channel = null;
      connection = null;
    });

    connection.on('close', () => {
      log.warn({ msg: 'RabbitMQ connection closed' });
      channel = null;
      connection = null;
    });

    channel = await connection.createChannel();

    channel.on('error', (err) => {
      log.error({ error: err.message, msg: 'RabbitMQ channel error' });
      channel = null;
    });

    channel.on('close', () => {
      log.warn({ msg: 'RabbitMQ channel closed' });
      channel = null;
    });

    // Ensure the close-order-events exchange exists (idempotent)
    await channel.assertExchange(EXCHANGE_CLOSE_ORDER_EVENTS, 'topic', {
      durable: true,
      autoDelete: false,
    });

    log.info({ msg: 'RabbitMQ connected, close-order-events exchange ready' });
    return channel;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}
