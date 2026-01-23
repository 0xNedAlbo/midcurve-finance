/**
 * Pool Price Subscriber Module
 *
 * Exports the PoolPriceSubscriber class and related types
 * for consuming pool price events from RabbitMQ.
 */

export { PoolPriceSubscriber, createPoolPriceSubscriber } from './pool-price-subscriber.js';

export type {
  PoolPriceMessageHandler,
  PoolPriceErrorHandler,
  PoolPriceSubscriberState,
  PoolPriceSubscriberOptions,
  PoolPriceSubscriberStatus,
} from './types.js';
