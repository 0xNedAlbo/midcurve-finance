/**
 * Pool Discovery Input Types
 *
 * Service-layer input types for pool discovery operations.
 * These types are protocol-specific and used by PoolDiscoveryService implementations.
 *
 * Note: These are service-layer types, not shared with UI/API.
 * The UI/API receives PoolDiscoveryResult objects with full data.
 */

/**
 * Uniswap V3 pool discovery input
 *
 * Parameters needed to discover all Uniswap V3 pools for a token pair.
 * The service will:
 * 1. Normalize and sort token addresses (token0 < token1)
 * 2. Query factory for all fee tiers (100, 500, 3000, 10000 bps)
 * 3. Fetch pool state for existing pools
 * 4. Enrich with subgraph metrics
 */
export interface UniswapV3PoolDiscoveryInput {
  /**
   * Chain ID where pools exist
   *
   * Examples:
   * - 1: Ethereum
   * - 42161: Arbitrum
   * - 8453: Base
   * - 10: Optimism
   * - 137: Polygon
   */
  chainId: number;

  /**
   * First token address (any case, will be normalized)
   *
   * Can be provided in any case - service will normalize to EIP-55 checksum.
   * Order doesn't matter - service will sort addresses to ensure token0 < token1.
   *
   * @example "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // WETH
   * @example "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" // Also valid
   */
  tokenA: string;

  /**
   * Second token address (any case, will be normalized)
   *
   * Can be provided in any case - service will normalize to EIP-55 checksum.
   * Order doesn't matter - service will sort addresses to ensure token0 < token1.
   *
   * @example "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // USDC
   * @example "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" // Also valid
   */
  tokenB: string;
}

/**
 * Union of all pool discovery inputs
 */
export type PoolDiscoveryInput = UniswapV3PoolDiscoveryInput;
