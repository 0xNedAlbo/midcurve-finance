/**
 * RabbitMQ Module Exports
 *
 * Provides connection management, topology setup, and message handling
 * for the Core orchestrator.
 */

// Connection management
export { MQClient, createDefaultMQClient, type MQConfig } from './client';

// Topology setup
export {
  // Constants
  EXCHANGES,
  QUEUES,
  ROUTING_KEYS,
  // Core topology
  setupCoreTopology,
  verifyCoreTopology,
  // Per-strategy topology
  setupStrategyTopology,
  verifyStrategyTopology,
  teardownStrategyTopology,
  // OHLC subscription management
  bindOhlcSubscription,
  unbindOhlcSubscription,
} from './topology';

// Message types and serialization
export {
  // Types
  type EffectRequestMessage,
  type EffectResultMessage,
  type StepEventMessage,
  // Serialization
  serializeMessage,
  deserializeMessage,
  bigintToString,
  stringToBigint,
  generateCorrelationId,
  // Message builders
  createEffectRequest,
  createEffectResult,
  createStepEvent,
  // Lifecycle event constants and builder
  STEP_EVENT_LIFECYCLE,
  LIFECYCLE_EVENT_VERSION,
  LIFECYCLE_START,
  LIFECYCLE_SHUTDOWN,
  createLifecycleEvent,
  // Type guards
  isEffectRequestMessage,
  isEffectResultMessage,
  isStepEventMessage,
} from './messages';

// Effect request publishing
export {
  publishEffectRequest,
  publishEffectRequestWithRetry,
} from './effect-publisher';

// Effect result consumption
export {
  type ConsumedResult,
  tryConsumeResult,
  consumeResult,
  ackResult,
  nackResult,
} from './result-consumer';

// Step event consumption
export {
  type ConsumedEvent,
  tryConsumeEvent,
  consumeEvent,
  ackEvent,
  nackEvent,
  publishEvent,
} from './event-consumer';

// Connection manager (for API routes)
export {
  getRabbitMQConnection,
  type RabbitMQConnectionManager,
} from './connection';
