/**
 * Message Queue Module
 *
 * RabbitMQ utilities and consumers for midcurve-services.
 * Provides pool price subscription capabilities.
 */

// Types
export type { RabbitMQConfig, RawSwapEventWrapper } from './types.js';

// Configuration
export {
  EXCHANGE_POOL_PRICES,
  buildPoolPriceRoutingKey,
  buildSubscriberQueueName,
  getRabbitMQConfig,
  buildConnectionUrl,
} from './config.js';

// Pool Price Subscriber
export { PoolPriceSubscriber, createPoolPriceSubscriber } from './pool-price-subscriber/index.js';

export type {
  PoolPriceMessageHandler,
  PoolPriceErrorHandler,
  PoolPriceSubscriberState,
  PoolPriceSubscriberOptions,
  PoolPriceSubscriberStatus,
} from './pool-price-subscriber/index.js';
