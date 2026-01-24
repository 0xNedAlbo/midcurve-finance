/**
 * Typed Pool Discovery Response Types
 *
 * These types provide full type safety for UI components consuming
 * pool discovery results from the API. They replace the loosely-typed
 * Record<string, unknown> fields with protocol-specific interfaces.
 */

import type {
  UniswapV3PoolResponse,
  Erc20TokenResponse,
} from '../positions/uniswapv3/typed-response.js';

/**
 * Pool discovery result as it appears in API responses.
 *
 * This is the fully-typed version of PoolDiscoveryResult<'uniswapv3'>.
 * Use this in UI components for full type safety when accessing
 * pool.config.address, pool.state.sqrtPriceX96, etc.
 */
export interface UniswapV3PoolDiscoveryResultResponse {
  /**
   * Protocol-dependent pool name
   * Format: "CL10-WETH/USDC" (CL = Concentrated Liquidity, 10 = tick spacing)
   */
  poolName: string;

  /**
   * Fee in basis points (BIPS)
   * Examples: 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%
   */
  fee: number;

  /**
   * Protocol identifier
   */
  protocol: 'uniswapv3';

  /**
   * Total Value Locked in USD (from subgraph/indexer)
   * String format to handle large numbers without precision loss.
   */
  tvlUSD: string;

  /**
   * 24-hour trading volume in USD (from subgraph/indexer)
   */
  volumeUSD: string;

  /**
   * 24-hour fees collected in USD (from subgraph/indexer)
   */
  feesUSD: string;

  /**
   * 24-hour trading volume for token0 (optional)
   * String representation of BigInt in token0's native decimals.
   */
  volumeToken0?: string;

  /**
   * 24-hour trading volume for token1 (optional)
   * String representation of BigInt in token1's native decimals.
   */
  volumeToken1?: string;

  /**
   * Price of token0 in token1 terms (optional)
   */
  token0Price?: string;

  /**
   * Price of token1 in token0 terms (optional)
   */
  token1Price?: string;

  /**
   * Full pool object with typed config and state
   */
  pool: UniswapV3PoolResponse;
}

/**
 * Typed array of pool discovery results for API responses
 */
export type DiscoverUniswapV3PoolsResponseData =
  UniswapV3PoolDiscoveryResultResponse[];

/**
 * Re-export token response type for convenience
 */
export type { Erc20TokenResponse, UniswapV3PoolResponse };
