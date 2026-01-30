/**
 * Pool Search Input Types
 *
 * Service-layer input types for pool search operations.
 * Used by UniswapV3PoolSearchService to search pools by token sets.
 */

/**
 * Pool search input for finding pools by token sets
 *
 * Searches for pools where:
 * - token0 is in tokenSetA AND token1 is in tokenSetB, OR
 * - token0 is in tokenSetB AND token1 is in tokenSetA
 *
 * This allows finding all pools between two groups of tokens.
 *
 * @example
 * ```typescript
 * const input: UniswapV3PoolSearchInput = {
 *   tokenSetA: ['WETH', 'stETH'],    // Base tokens
 *   tokenSetB: ['USDC', 'USDT'],     // Quote tokens
 *   chainIds: [1, 42161],            // Search on Ethereum and Arbitrum
 *   sortBy: 'tvlUSD',
 *   limit: 20,
 * };
 * ```
 */
export interface UniswapV3PoolSearchInput {
  /**
   * First set of tokens (addresses or symbols)
   *
   * Can be:
   * - Token addresses (any case, will be normalized)
   * - Token symbols (will be resolved via CoingeckoTokenService)
   *
   * @example ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0xae7ab96520de3a18e5e111b5eaab095312d7fe84']
   * @example ['WETH', 'stETH']
   */
  tokenSetA: string[];

  /**
   * Second set of tokens (addresses or symbols)
   *
   * Same format as tokenSetA.
   *
   * @example ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7']
   * @example ['USDC', 'USDT']
   */
  tokenSetB: string[];

  /**
   * Chain IDs to search on
   *
   * Supported chains:
   * - 1: Ethereum
   * - 42161: Arbitrum
   * - 8453: Base
   * - 10: Optimism
   * - 137: Polygon
   */
  chainIds: number[];

  /**
   * Field to sort results by
   *
   * @default 'tvlUSD'
   */
  sortBy?: 'tvlUSD' | 'volume24hUSD' | 'fees24hUSD' | 'apr7d';

  /**
   * Sort direction
   *
   * @default 'desc'
   */
  sortDirection?: 'asc' | 'desc';

  /**
   * Maximum number of results to return
   *
   * @default 20
   * @max 100
   */
  limit?: number;
}

/**
 * Resolved token address per chain
 *
 * Used internally to track which addresses were resolved for each token
 * on each requested chain.
 */
export interface ResolvedTokenAddress {
  /** Original input (symbol or address) */
  input: string;
  /** Chain ID */
  chainId: number;
  /** Resolved address (EIP-55 checksummed) */
  address: string;
  /** Token symbol */
  symbol: string;
}
