/**
 * Strategy Service Index
 *
 * Re-exports all strategy service classes, types, and utilities.
 *
 * NOTE: Strategy metrics are NOT stored in the database.
 * Use StrategyMetricsService to compute metrics on-demand from
 * StrategyLedgerEvent records and position state.
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
  // Metrics validation error classes
  StrategyQuoteTokenMismatchError,
  PositionNoBasicCurrencyError,
  StrategyBasicCurrencyMismatchError,
} from './helpers/index.js';
