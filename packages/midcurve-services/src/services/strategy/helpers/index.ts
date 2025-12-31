/**
 * Strategy Helpers Index
 *
 * Re-exports all helper functions and classes for strategy management.
 */

// State transition helpers
export {
  VALID_STATE_TRANSITIONS,
  isValidTransition,
  getValidNextStates,
  isTerminalState,
  canModify,
  StrategyInvalidStateError,
} from './state-transitions.js';

// Metrics validation error classes
// NOTE: Strategy metrics are computed on-demand by StrategyMetricsService,
// not stored in the database. These error classes are for validation.
export {
  StrategyQuoteTokenMismatchError,
  PositionNoBasicCurrencyError,
  StrategyBasicCurrencyMismatchError,
} from './metrics-calculator.js';
