/**
 * Uniswap V3 Pool Price Configuration
 *
 * Immutable configuration for historic pool price snapshots.
 * These values identify when and at which block the price was recorded.
 */

/**
 * Uniswap V3 Pool Price Configuration (Immutable)
 *
 * Contains the block information for when this price snapshot was taken.
 * This allows precise historical lookups and verification against blockchain data.
 */
export interface UniswapV3PoolPriceConfig {
  /**
   * Block number when the price was recorded
   * Used for precise historical lookups and verification
   *
   * @example 18000000
   */
  blockNumber: number;

  /**
   * Block timestamp (Unix timestamp in seconds)
   * Redundant with timestamp field but stored for verification
   *
   * @example 1693526400
   */
  blockTimestamp: number;
}
