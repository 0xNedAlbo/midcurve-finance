/**
 * Automation Services Index
 *
 * Re-exports all automation service classes and types.
 * These services handle position automation features:
 * - On-chain close orders (price-triggered position closing)
 * - Close order executions (individual execution attempt tracking)
 * - Shared contracts (versioned contract registry)
 * - Automation subscriptions (pool price monitoring via OnchainDataSubscribers)
 * - Pool price subscriber (RabbitMQ consumer for swap events)
 * - Automation logs (user-facing event logs)
 */

// Close order service
export { CloseOrderService } from './close-order-service.js';
export type {
  CloseOrderServiceDependencies,
  CloseOrderWithPosition,
} from './close-order-service.js';

// Close order execution service
export { CloseOrderExecutionService } from './close-order-execution-service.js';
export type { CloseOrderExecutionServiceDependencies } from './close-order-execution-service.js';

export { SharedContractService } from './shared-contract-service.js';
export type {
  SharedContractServiceDependencies,
  UpsertSharedContractInput,
} from './shared-contract-service.js';

// Automation subscription service (replaces PoolSubscriptionService)
export { AutomationSubscriptionService } from './automation-subscription-service.js';
export type { AutomationSubscriptionServiceDependencies } from './automation-subscription-service.js';

// Pool price subscriber (RabbitMQ consumer for swap events)
export { PoolPriceSubscriber, createPoolPriceSubscriber, EXCHANGE_POOL_PRICES, buildPoolPriceRoutingKey } from './pool-price-subscriber.js';
export type {
  RabbitMQConfig,
  RawSwapEventWrapper,
  PoolPriceMessageHandler,
  PoolPriceErrorHandler,
  PoolPriceSubscriberState,
  PoolPriceSubscriberOptions,
  PoolPriceSubscriberStatus,
} from './pool-price-subscriber.types.js';

export {
  AutomationLogService,
  LogLevel,
  AutomationLogType,
} from './automation-log-service.js';
export type {
  AutomationLogServiceDependencies,
  ListAutomationLogsResult,
  LogLevelType,
  AutomationLogTypeValue,
} from './automation-log-service.js';
