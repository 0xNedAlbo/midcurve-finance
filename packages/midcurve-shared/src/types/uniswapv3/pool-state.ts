/**
 * Uniswap V3 Pool State
 *
 * Mutable state for Uniswap V3 pools.
 * This state changes with swaps and liquidity updates.
 */

/**
 * Uniswap V3 Pool State (Mutable)
 *
 * Contains the current state of a Uniswap V3 pool.
 * Uses native bigint for type safety and calculations.
 * This state changes with swaps and liquidity updates.
 */
export interface UniswapV3PoolState {
  /**
   * Current sqrt(price) as a Q64.96 fixed-point value
   * Range: uint160
   *
   * To calculate price:
   * price = (sqrtPriceX96 / 2^96)^2
   */
  sqrtPriceX96: bigint;

  /**
   * Current tick of the pool
   * Represents log base 1.0001 of the price
   * Range: int24 (-887272 to 887272)
   */
  currentTick: number;

  /**
   * Total liquidity currently in the pool
   * Range: uint128
   */
  liquidity: bigint;

  /**
   * Accumulated fees per unit of liquidity for token0
   * Range: uint256
   * Used to calculate fees owed to liquidity providers
   */
  feeGrowthGlobal0: bigint;

  /**
   * Accumulated fees per unit of liquidity for token1
   * Range: uint256
   * Used to calculate fees owed to liquidity providers
   */
  feeGrowthGlobal1: bigint;
}
