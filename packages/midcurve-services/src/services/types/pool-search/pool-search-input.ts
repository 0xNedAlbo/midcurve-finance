/**
 * Pool Search Input Types
 *
 * Service-layer input types for pool search operations.
 * Used by UniswapV3PoolSearchService to search pools by token sets.
 */

/**
 * Pool search input for finding pools by base/quote token sets
 *
 * Searches the cartesian product `base × quote` per chain (with same-token
 * pairs excluded). Each result is annotated with `userProvidedInfo.isToken0Quote`
 * derived per pool by checking which side appears in `quote`.
 *
 * @example
 * ```typescript
 * const input: UniswapV3PoolSearchInput = {
 *   base: ['WETH', 'stETH'],
 *   quote: ['USDC', 'USDT'],
 *   chainIds: [1, 42161],
 *   sortBy: 'tvlUSD',
 *   limit: 20,
 * };
 * ```
 */
export interface UniswapV3PoolSearchInput {
  /**
   * Base side of the pair (addresses or exact CoinGecko symbols).
   *
   * Can be:
   * - Token addresses (any case, will be normalized)
   * - Token symbols — must match a CoinGecko symbol exactly
   *   (case-insensitive). Fuzzy / prefix matching is the consumer's
   *   responsibility.
   *
   * @example ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0xae7ab96520de3a18e5e111b5eaab095312d7fe84']
   * @example ['WETH', 'stETH']
   */
  base: string[];

  /**
   * Quote side of the pair (addresses or exact CoinGecko symbols).
   *
   * Same format as `base`. Determines `userProvidedInfo.isToken0Quote` on
   * each result — if a pool's `token0` resolves to a member of this set
   * (per chain), `isToken0Quote = true`.
   *
   * @example ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7']
   * @example ['USDC', 'USDT']
   */
  quote: string[];

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
  sortBy?:
    | 'tvlUSD'
    | 'volume24hUSD'
    | 'fees24hUSD'
    | 'volume7dAvgUSD'
    | 'fees7dAvgUSD'
    | 'apr7d';

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
