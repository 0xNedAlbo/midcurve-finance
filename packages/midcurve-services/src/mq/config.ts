/**
 * RabbitMQ Configuration
 *
 * Configuration utilities for RabbitMQ connections and pool-prices exchange.
 */

import type { RabbitMQConfig } from './types.js';

/**
 * Pool prices exchange name.
 * Must match the exchange created by midcurve-pool-prices.
 */
export const EXCHANGE_POOL_PRICES = 'pool-prices';

/**
 * Build routing key for UniswapV3 pool price events.
 *
 * Format: uniswapv3.{chainId}.{poolAddress}
 *
 * @example
 * buildPoolPriceRoutingKey(1, '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8')
 * // => 'uniswapv3.1.0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
 */
export function buildPoolPriceRoutingKey(chainId: number, poolAddress: string): string {
  return `uniswapv3.${chainId}.${poolAddress.toLowerCase()}`;
}

/**
 * Build unique queue name for a pool price subscriber.
 *
 * Queue is exclusive (only one consumer) and auto-deletes when consumer disconnects.
 * Uses timestamp to ensure uniqueness even if same pool subscribed multiple times.
 */
export function buildSubscriberQueueName(chainId: number, poolAddress: string): string {
  const uniqueId = Date.now().toString(36);
  const shortAddress = poolAddress.toLowerCase().slice(0, 10);
  return `pool-price-sub.${chainId}.${shortAddress}.${uniqueId}`;
}

/**
 * Get RabbitMQ configuration from environment variables.
 *
 * Environment variables:
 * - RABBITMQ_HOST (default: localhost)
 * - RABBITMQ_PORT (default: 5672)
 * - RABBITMQ_USER (default: midcurve)
 * - RABBITMQ_PASS (default: midcurve_dev)
 * - RABBITMQ_VHOST (optional)
 */
export function getRabbitMQConfig(): RabbitMQConfig {
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
 *
 * @example
 * buildConnectionUrl({ host: 'localhost', port: 5672, username: 'guest', password: 'guest' })
 * // => 'amqp://guest:guest@localhost:5672'
 */
export function buildConnectionUrl(config: RabbitMQConfig): string {
  const encodedUser = encodeURIComponent(config.username);
  const encodedPass = encodeURIComponent(config.password);
  const vhost = config.vhost ? `/${encodeURIComponent(config.vhost)}` : '';
  return `amqp://${encodedUser}:${encodedPass}@${config.host}:${config.port}${vhost}`;
}
