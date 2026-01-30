/**
 * Pool Search Endpoint Types
 *
 * Types for the POST /api/v1/pools/uniswapv3/search endpoint.
 * Allows searching for pools by token sets across multiple chains.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * POST /api/v1/pools/uniswapv3/search - Request body
 *
 * Search for pools matching token sets across multiple chains.
 */
export interface PoolSearchRequest {
  /**
   * First set of tokens (addresses or symbols)
   *
   * Can be:
   * - Token addresses (e.g., "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")
   * - Token symbols (e.g., "WETH", "stETH")
   *
   * @example ["WETH", "stETH"]
   * @example ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]
   */
  tokenSetA: string[];

  /**
   * Second set of tokens (addresses or symbols)
   *
   * Same format as tokenSetA.
   *
   * @example ["USDC", "USDT", "DAI"]
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
   *
   * @example [1, 42161]
   */
  chainIds: number[];

  /**
   * Field to sort results by
   *
   * @default "tvlUSD"
   */
  sortBy?: 'tvlUSD' | 'volume24hUSD' | 'fees24hUSD' | 'apr7d';

  /**
   * Sort direction
   *
   * @default "desc"
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

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Token information in search result
 */
export interface PoolSearchTokenInfo {
  /** Token contract address (EIP-55 checksummed) */
  address: string;
  /** Token symbol (e.g., "WETH") */
  symbol: string;
  /** Token decimals (e.g., 18) */
  decimals: number;
}

/**
 * Single pool search result
 */
export interface PoolSearchResultItem {
  /** Pool contract address (EIP-55 checksummed) */
  poolAddress: string;
  /** Chain ID where pool exists */
  chainId: number;
  /** Human-readable chain name (e.g., "Ethereum", "Arbitrum One") */
  chainName: string;
  /** Fee tier in basis points (e.g., 500, 3000, 10000) */
  feeTier: number;

  /** Token0 information */
  token0: PoolSearchTokenInfo;
  /** Token1 information */
  token1: PoolSearchTokenInfo;

  /** Current Total Value Locked in USD */
  tvlUSD: string;
  /** Most recent 24h trading volume in USD */
  volume24hUSD: string;
  /** Most recent 24h fees collected in USD */
  fees24hUSD: string;
  /** Sum of fees from last 7 days in USD */
  fees7dUSD: string;
  /**
   * 7-day average APR
   *
   * Calculated as: (fees7d / 7 * 365) / tvl * 100
   * Rounded to 2 decimal places.
   */
  apr7d: number;
}

/**
 * POST /api/v1/pools/uniswapv3/search - Response data
 */
export type PoolSearchData = PoolSearchResultItem[];

/**
 * POST /api/v1/pools/uniswapv3/search - Full response
 */
export interface PoolSearchResponse extends ApiResponse<PoolSearchData> {
  /**
   * Metadata about the search results
   */
  meta?: {
    /** Total pools found (before limit applied) */
    totalFound: number;
    /** Number of pools returned */
    count: number;
    /** Sort field used */
    sortBy: string;
    /** Sort direction used */
    sortDirection: string;
    /** Chains searched */
    chainIds: number[];
  };
}

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/**
 * Supported chain IDs for pool search
 */
const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 10, 137] as const;

/**
 * POST /api/v1/pools/uniswapv3/search - Request validation
 */
export const PoolSearchRequestSchema = z.object({
  tokenSetA: z
    .array(z.string().min(1, 'Token cannot be empty'))
    .min(1, 'tokenSetA must have at least one token')
    .max(10, 'tokenSetA cannot have more than 10 tokens'),

  tokenSetB: z
    .array(z.string().min(1, 'Token cannot be empty'))
    .min(1, 'tokenSetB must have at least one token')
    .max(10, 'tokenSetB cannot have more than 10 tokens'),

  chainIds: z
    .array(
      z
        .number()
        .int('Chain ID must be an integer')
        .refine(
          (id) => SUPPORTED_CHAIN_IDS.includes(id as (typeof SUPPORTED_CHAIN_IDS)[number]),
          (id) => ({ message: `Chain ID ${id} is not supported. Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}` })
        )
    )
    .min(1, 'At least one chain ID is required')
    .max(5, 'Cannot search more than 5 chains at once'),

  sortBy: z
    .enum(['tvlUSD', 'volume24hUSD', 'fees24hUSD', 'apr7d'])
    .optional()
    .default('tvlUSD'),

  sortDirection: z.enum(['asc', 'desc']).optional().default('desc'),

  limit: z
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .optional()
    .default(20),
});

/**
 * Inferred type from schema (for runtime validation)
 */
export type PoolSearchRequestValidated = z.infer<typeof PoolSearchRequestSchema>;
