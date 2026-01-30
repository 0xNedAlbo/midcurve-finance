/**
 * Uniswap V3 Subgraph Types
 *
 * TypeScript interfaces for The Graph subgraph responses and data structures.
 * These types map to the Uniswap V3 subgraph schema.
 *
 * Schema reference: https://github.com/Uniswap/v3-subgraph
 */

/**
 * GraphQL response envelope from The Graph
 *
 * All subgraph queries return data in this format, with optional errors.
 */
export interface SubgraphResponse<T> {
  /**
   * Query result data (if successful)
   * Structure depends on the specific query
   */
  data?: T;

  /**
   * GraphQL errors (if query failed or returned partial data)
   * Presence of errors indicates a problem with the query or subgraph
   */
  errors?: Array<{
    /** Human-readable error message */
    message: string;
    /** Source locations in the GraphQL query where error occurred */
    locations?: Array<{ line: number; column: number }>;
    /** Path to the field in the response that caused the error */
    path?: string[];
  }>;
}

/**
 * Pool metrics from subgraph
 *
 * Lightweight metrics for PoolDiscoveryService to rank and display pools.
 * All USD values are strings to handle large numbers without precision loss.
 */
export interface PoolMetrics {
  /**
   * Total Value Locked in USD
   * Example: "234567890.75"
   */
  tvlUSD: string;

  /**
   * 24-hour trading volume in USD
   * Example: "23456789.12"
   */
  volumeUSD: string;

  /**
   * 24-hour fees collected in USD
   * Example: "2345.67"
   */
  feesUSD: string;
}

/**
 * Detailed pool fee data from subgraph
 *
 * Comprehensive data for fee analysis, APR calculations, and position analytics.
 * Includes token-level data (prices, volumes) and pool state.
 *
 * Used by:
 * - PoolDiscoveryService (for detailed pool analysis)
 * - Fee calculation services
 * - APR calculation services
 */
export interface PoolFeeData {
  /**
   * Pool contract address (normalized to EIP-55 checksum)
   * Example: "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8"
   */
  poolAddress: string;

  /**
   * Chain ID where pool exists
   * Example: 1 (Ethereum), 42161 (Arbitrum)
   */
  chainId: number;

  /**
   * Fee tier in basis points as string
   * Example: "500" (0.05%), "3000" (0.3%), "10000" (1%)
   */
  feeTier: string;

  /**
   * Current pool liquidity (BigInt as string)
   * Example: "5234567890123456789"
   */
  poolLiquidity: string;

  /**
   * Current sqrt price as Q64.96 (BigInt as string)
   * Example: "1234567890123456789012345678901"
   */
  sqrtPriceX96: string;

  /**
   * Total Value Locked in USD (from poolDayData)
   * Example: "234567890.75"
   */
  tvlUSD: string;

  /**
   * 24-hour trading volume in USD (from poolDayData)
   * Example: "23456789.12"
   */
  volumeUSD: string;

  /**
   * 24-hour fees collected in USD (from poolDayData)
   * Example: "2345.67"
   */
  feesUSD: string;

  /**
   * Token0 data (lower address in pool pair)
   */
  token0: {
    /**
     * Token0 contract address (normalized)
     * Example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
     */
    address: string;

    /**
     * Token0 symbol
     * Example: "USDC"
     */
    symbol: string;

    /**
     * Token0 decimals
     * Example: 6
     */
    decimals: number;

    /**
     * Token0 24h volume in token units (BigInt as string)
     * Example: "12345678901234"
     */
    dailyVolume: string;

    /**
     * Token0 price in token1 terms (BigInt as string)
     * Scaled by token1 decimals
     * Example: "4016123456" (for USDC/WETH, price of USDC in WETH)
     */
    price: string;
  };

  /**
   * Token1 data (higher address in pool pair)
   */
  token1: {
    /**
     * Token1 contract address (normalized)
     * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
     */
    address: string;

    /**
     * Token1 symbol
     * Example: "WETH"
     */
    symbol: string;

    /**
     * Token1 decimals
     * Example: 18
     */
    decimals: number;

    /**
     * Token1 24h volume in token units (BigInt as string)
     * Example: "123456789012345678"
     */
    dailyVolume: string;

    /**
     * Token1 price in token0 terms (BigInt as string)
     * Scaled by token0 decimals
     * Example: "248901234567890" (for WETH/USDC, price of WETH in USDC)
     */
    price: string;
  };

  /**
   * Timestamp when this data was calculated/fetched
   */
  calculatedAt: Date;
}

/**
 * Raw pool data from subgraph query
 *
 * Internal type mapping to the subgraph's pool entity schema.
 * Not exported - used for parsing subgraph responses internally.
 */
export interface RawPoolData {
  /** Pool address (lowercase from subgraph) */
  id: string;
  /** Fee tier as string (e.g., "500", "3000", "10000") */
  feeTier: string;
  /** Current sqrt price as decimal string */
  sqrtPrice: string;
  /** Current liquidity as decimal string */
  liquidity: string;

  /** Token0 entity */
  token0: {
    /** Token address (lowercase) */
    id: string;
    /** Token symbol */
    symbol: string;
    /** Token decimals as string */
    decimals: string;
  };

  /** Token1 entity */
  token1: {
    /** Token address (lowercase) */
    id: string;
    /** Token symbol */
    symbol: string;
    /** Token decimals as string */
    decimals: string;
  };

  /** Pool day data (most recent first) */
  poolDayData: Array<{
    /** Unix timestamp */
    date: number;
    /** Liquidity as decimal string */
    liquidity: string;
    /** Token0 volume as decimal string */
    volumeToken0: string;
    /** Token1 volume as decimal string */
    volumeToken1: string;
    /** Token0 price in token1 terms */
    token1Price: string;
    /** Token1 price in token0 terms */
    token0Price: string;
    /** 24h volume in USD */
    volumeUSD: string;
    /** 24h fees in USD */
    feesUSD: string;
    /** Total Value Locked in USD */
    tvlUSD: string;
  }>;
}

/**
 * Error thrown when Uniswap V3 subgraph API returns an error
 *
 * This includes:
 * - HTTP errors (4xx, 5xx)
 * - GraphQL errors (invalid query, data issues)
 *
 * These are NOT transient network errors - they indicate a problem with
 * the query or subgraph that won't be resolved by retrying.
 */
export class UniswapV3SubgraphApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly graphqlErrors?: Array<{ message: string }>
  ) {
    super(message);
    this.name = 'UniswapV3SubgraphApiError';
  }
}

/**
 * Error thrown when Uniswap V3 subgraph is temporarily unavailable
 *
 * This includes:
 * - Network errors (connection failures)
 * - Timeouts
 *
 * These are transient errors that may be resolved by retrying.
 * Consumers can choose to return default values (e.g., "0" for metrics)
 * rather than failing completely.
 */
export class UniswapV3SubgraphUnavailableError extends Error {
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'UniswapV3SubgraphUnavailableError';
    this.cause = cause;
  }
}

/**
 * Error thrown when pool is not found in subgraph
 *
 * This can happen if:
 * - Pool doesn't exist at the given address
 * - Pool exists but hasn't been indexed yet
 * - Subgraph is out of sync with chain state
 */
export class PoolNotFoundInSubgraphError extends Error {
  constructor(
    public readonly chainId: number,
    public readonly poolAddress: string
  ) {
    super(
      `Pool ${poolAddress} not found in Uniswap V3 subgraph for chain ${chainId}`
    );
    this.name = 'PoolNotFoundInSubgraphError';
  }
}

// ============================================================================
// POOL SEARCH TYPES
// ============================================================================

/**
 * Raw pool data from POOLS_BY_TOKEN_SETS_QUERY
 *
 * Internal type for parsing pool search responses.
 * Includes 7 days of poolDayData for APR calculation.
 */
export interface RawPoolSearchData {
  /** Pool address (lowercase from subgraph) */
  id: string;
  /** Fee tier as string (e.g., "500", "3000", "10000") */
  feeTier: string;
  /** Current sqrt price as decimal string */
  sqrtPrice: string;
  /** Current liquidity as decimal string */
  liquidity: string;
  /** Current tick as string */
  tick: string;
  /** Total Value Locked in USD (current) */
  totalValueLockedUSD: string;

  /** Token0 entity */
  token0: {
    /** Token address (lowercase) */
    id: string;
    /** Token symbol */
    symbol: string;
    /** Token decimals as string */
    decimals: string;
  };

  /** Token1 entity */
  token1: {
    /** Token address (lowercase) */
    id: string;
    /** Token symbol */
    symbol: string;
    /** Token decimals as string */
    decimals: string;
  };

  /** Pool day data (7 days, most recent first) */
  poolDayData: Array<{
    /** Unix timestamp (seconds) */
    date: number;
    /** 24h volume in USD */
    volumeUSD: string;
    /** 24h fees in USD */
    feesUSD: string;
    /** TVL in USD at end of day */
    tvlUSD: string;
  }>;
}

/**
 * Processed pool search result from subgraph client
 *
 * Returned by searchPoolsByTokenSets() with calculated metrics.
 * All USD values are strings to preserve precision.
 */
export interface PoolSearchSubgraphResult {
  /** Pool contract address (normalized to EIP-55 checksum) */
  poolAddress: string;
  /** Chain ID where pool exists */
  chainId: number;
  /** Fee tier in basis points (e.g., 500, 3000, 10000) */
  feeTier: number;

  /** Token0 data (lower address in pool pair) */
  token0: {
    /** Token address (normalized) */
    address: string;
    /** Token symbol */
    symbol: string;
    /** Token decimals */
    decimals: number;
  };

  /** Token1 data (higher address in pool pair) */
  token1: {
    /** Token address (normalized) */
    address: string;
    /** Token symbol */
    symbol: string;
    /** Token decimals */
    decimals: number;
  };

  /** Current Total Value Locked in USD */
  tvlUSD: string;
  /** Most recent 24h volume in USD */
  volume24hUSD: string;
  /** Most recent 24h fees in USD */
  fees24hUSD: string;
  /** Sum of fees from last 7 days in USD */
  fees7dUSD: string;
  /** 7-day average APR: (fees7d/7 * 365) / tvl * 100 */
  apr7d: number;
}
