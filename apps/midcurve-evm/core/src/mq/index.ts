/**
 * RabbitMQ Module Exports
 *
 * Provides connection management, topology setup, and message handling
 * for the Core orchestrator.
 */

// Connection management
export { MQClient, createDefaultMQClient, type MQConfig } from './client.js';

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
} from './topology.js';

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
  // Type guards
  isEffectRequestMessage,
  isEffectResultMessage,
  isStepEventMessage,
} from './messages.js';

// Effect request publishing
export {
  publishEffectRequest,
  publishEffectRequestWithRetry,
} from './effect-publisher.js';

// Effect result consumption
export {
  type ConsumedResult,
  tryConsumeResult,
  consumeResult,
  ackResult,
  nackResult,
} from './result-consumer.js';

// Step event consumption
export {
  type ConsumedEvent,
  tryConsumeEvent,
  consumeEvent,
  ackEvent,
  nackEvent,
  publishEvent,
} from './event-consumer.js';
