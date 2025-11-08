/**
 * Uniswap V3 Pool Discovery Endpoint Types
 *
 * Types for Uniswap V3 pool discovery endpoints.
 * Imports domain types from @midcurve/shared for consistency.
 */

import { z } from 'zod';
import type { PoolDiscoveryResult } from '@midcurve/shared';
import type { ApiResponse } from '../common/index.js';

/**
 * GET /api/pools/uniswapv3/discover - Query params
 *
 * All parameters are required for pool discovery.
 */
export interface DiscoverUniswapV3PoolsQuery {
  /**
   * EVM chain ID where pools exist
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * First token address (any format, normalized by service)
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
   */
  tokenA: string;

  /**
   * Second token address (any format, normalized by service)
   * Example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
   */
  tokenB: string;
}

/**
 * GET /api/pools/uniswapv3/discover - Response data
 *
 * Array of pool discovery results from @midcurve/shared.
 * Sorted by TVL descending.
 *
 * Note: The actual response contains serialized versions of these types
 * (bigint fields converted to strings for JSON compatibility).
 */
export type DiscoverUniswapV3PoolsData = PoolDiscoveryResult<'uniswapv3'>[];

/**
 * GET /api/pools/uniswapv3/discover - Full response
 */
export interface DiscoverUniswapV3PoolsResponse
  extends ApiResponse<DiscoverUniswapV3PoolsData> {
  /**
   * Additional metadata about the discovery results
   */
  meta?: {
    /** Number of pools found */
    count: number;
    /** Chain ID queried */
    chainId: number;
    /** Timestamp of the response */
    timestamp: string;
  };
}

/**
 * GET /api/pools/uniswapv3/discover - Query validation
 *
 * All three parameters are required for pool discovery.
 */
export const DiscoverUniswapV3PoolsQuerySchema = z.object({
  chainId: z.coerce
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
  tokenA: z
    .string()
    .min(1, 'tokenA is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format for tokenA'),
  tokenB: z
    .string()
    .min(1, 'tokenB is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format for tokenB'),
});
