/**
 * Uniswap V3 Utilities
 *
 * Pure mathematical utilities for Uniswap V3 calculations
 * All functions work with primitive parameters - no custom data structures required
 */

// Types and constants
export * from './types.js';
export * from './constants.js';

// Core utilities
export * from './price.js';
export * from './liquidity.js';
export * from './position.js';
export * from './utils.js';
export * from './fees.js';

// Commonly used functions (convenience re-exports)
export {
  // Price/tick conversions
  priceToSqrtRatioX96,
  tickToPrice,
  priceToTick,
  priceToClosestUsableTick,
  tickToSqrtRatioX96,
  sqrtRatioX96ToToken1PerToken0,
  sqrtRatioX96ToToken0PerToken1,
} from './price.js';

export {
  // Liquidity calculations
  getTokenAmountsFromLiquidity,
  getLiquidityFromTokenAmounts,
} from './liquidity.js';

export {
  // Position analysis
  determinePhase,
  calculatePnL,
  generatePnLCurve,
  calculatePositionValueAtPrice,
} from './position.js';

export {
  // Utility functions
  sameAddress,
  isToken0,
  sortTokens,
  getTokenMapping,
  getTickSpacing,
} from './utils.js';

export {
  // Fee calculations
  safeDiff,
  computeFeeGrowthInside,
  calculateIncrementalFees,
} from './fees.js';
