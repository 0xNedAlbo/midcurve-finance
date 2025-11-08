/**
 * Uniswap V3 Pool Configuration
 *
 * Immutable configuration for Uniswap V3 pools.
 * These values are set when the pool is created and never change.
 */

/**
 * Uniswap V3 Pool Configuration (Immutable)
 *
 * Contains all immutable parameters that define a Uniswap V3 pool.
 * These values are set when the pool is created and never change.
 */
export interface UniswapV3PoolConfig {
  /**
   * Chain ID where the pool is deployed
   * Examples: 1 (Ethereum), 56 (BSC), 137 (Polygon), 42161 (Arbitrum)
   */
  chainId: number;

  /**
   * Pool contract address
   * Format: 0x... (42 characters, EIP-55 checksummed)
   */
  address: string;

  /**
   * Token0 ERC-20 contract address
   * By convention, token0 < token1 (lexicographic comparison)
   */
  token0: string;

  /**
   * Token1 ERC-20 contract address
   * By convention, token1 > token0 (lexicographic comparison)
   */
  token1: string;

  /**
   * Fee tier in basis points
   * Duplicated from base Pool.feeBps for convenience
   * - 100 = 0.01% (1 bps)
   * - 500 = 0.05% (5 bps)
   * - 3000 = 0.3% (30 bps)
   * - 10000 = 1% (100 bps)
   */
  feeBps: number;

  /**
   * Tick spacing for this fee tier
   * Determines the granularity of price ranges
   * - 1 for 0.01% fee tier
   * - 10 for 0.05% fee tier
   * - 60 for 0.3% fee tier
   * - 200 for 1% fee tier
   */
  tickSpacing: number;
}
