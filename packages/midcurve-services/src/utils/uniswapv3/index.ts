/**
 * Uniswap V3 Utilities
 *
 * Barrel export for Uniswap V3 pool and ledger utilities.
 */

export { uniswapV3PoolAbi, type Slot0 } from './pool-abi.js';
export {
  readPoolConfig,
  readPoolState,
  PoolConfigError,
  PoolStateError,
} from './pool-reader.js';
export {
  calculatePoolPriceInQuoteToken,
  calculateTokenValueInQuote,
  calculateProportionalCostBasis,
  separateFeesFromPrincipal,
  updateUncollectedPrincipal,
  type FeeSeparationResult,
  type UncollectedPrincipalResult,
} from './ledger-calculations.js';
