/**
 * HODL Pool State
 *
 * Mutable state for HODL virtual pools.
 * Since HODL pools represent quote token reference (token0 = token1 = quoteToken),
 * the pool price is always 1 (quote token per quote token).
 */

export interface HodlPoolState {
  /**
   * Pool price - always 1 for HODL pools
   *
   * Represents: quote token units per 1 quote token (trivially 1).
   * Stored in quote token's smallest units with decimal normalization.
   *
   * @example
   * // USDC quote token (6 decimals): 1 USDC = 1 USDC
   * poolPrice = 1_000000n
   *
   * @example
   * // WETH quote token (18 decimals): 1 WETH = 1 WETH
   * poolPrice = 1_000000000000000000n
   */
  poolPrice: bigint;
}
