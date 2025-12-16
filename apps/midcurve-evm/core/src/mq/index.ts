/**
 * RabbitMQ Module Exports
 *
 * Provides connection management and topology setup for the Core orchestrator.
 */

export { MQClient, createDefaultMQClient, type MQConfig } from './client.js';

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
