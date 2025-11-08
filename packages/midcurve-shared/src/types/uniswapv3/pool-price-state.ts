/**
 * Uniswap V3 Pool Price State
 *
 * Contains the raw Uniswap V3 pool state at a specific block.
 * This state represents the pool's pricing information at a historical point in time.
 */

/**
 * Uniswap V3 Pool Price State
 *
 * Stores the sqrtPriceX96 and tick values from the pool's slot0
 * at a specific historical block. These values are used to derive
 * the token prices stored in the parent PoolPrice record.
 *
 * Uses native bigint for type safety and calculations.
 */
export interface UniswapV3PoolPriceState {
  /**
   * Historical sqrt(price) as a Q64.96 fixed-point value
   * Range: uint160
   *
   * This is the raw value from pool.slot0().sqrtPriceX96 at the recorded block.
   * To calculate price:
   * price = (sqrtPriceX96 / 2^96)^2
   */
  sqrtPriceX96: bigint;

  /**
   * Historical tick of the pool
   * Represents log base 1.0001 of the price at the recorded block
   * Range: int24 (-887272 to 887272)
   *
   * This is the raw value from pool.slot0().tick at the recorded block.
   */
  tick: number;
}
