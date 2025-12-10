/**
 * Strategy Service Index
 *
 * Re-exports all strategy service classes, types, and utilities.
 */

// Main service
export { StrategyService } from './strategy-service.js';
export type { StrategyServiceDependencies } from './strategy-service.js';

// Helpers
export {
  // State transitions
  VALID_STATE_TRANSITIONS,
  isValidTransition,
  getValidNextStates,
  isTerminalState,
  canModify,
  StrategyInvalidStateError,
  // Metrics
  createEmptyMetrics,
  aggregatePositionMetrics,
  parseMetricsFromDb,
  serializeMetricsToDb,
  StrategyQuoteTokenMismatchError,
  PositionNoBasicCurrencyError,
  StrategyBasicCurrencyMismatchError,
} from './helpers/index.js';
