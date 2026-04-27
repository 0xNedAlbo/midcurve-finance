/**
 * Pool Search Endpoint Types
 *
 * Types for the POST /api/v1/pools/uniswapv3/search endpoint.
 * Allows searching for pools by base/quote token sets across multiple chains.
 */

import { z } from 'zod';
import { isValidAddress, normalizeAddress } from '@midcurve/shared';
import type { ApiResponse } from '../common/index.js';
import type { PoolMetricsBlock } from './pool-metrics-shared.js';

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * POST /api/v1/pools/uniswapv3/search - Request body
 *
 * Search for pools matching base × quote token sets across multiple chains.
 *
 * Each pool result is annotated with `userProvidedInfo.isToken0Quote`,
 * derived per result by checking which of the pool's token0/token1 appears
 * in the `quote` array.
 *
 * **Symbol/address contract**: `base` and `quote` accept exact token symbols
 * (case-insensitive — must match a CoinGecko symbol exactly) or EIP-55
 * addresses. Fuzzy / prefix resolution is the consumer's responsibility —
 * passing `"eth"` will not match `WETH`/`stETH`/`rETH`.
 */
export interface PoolSearchRequest {
  /**
   * Base side of the pair.
   *
   * Accepts exact token symbols (case-insensitive — must match a CoinGecko
   * symbol exactly) or EIP-55 addresses. Fuzzy / prefix resolution is the
   * consumer's responsibility.
   *
   * @example ["WETH", "stETH"]
   * @example ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]
   */
  base: string[];

  /**
   * Quote side of the pair.
   *
   * Same format as `base`. The cartesian product `base × quote` is searched
   * (with same-token-on-both-sides pairs excluded per chain).
   *
   * @example ["USDC", "USDT", "DAI"]
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
   *
   * @example [1, 42161]
   */
  chainIds: number[];

  /**
   * Field to sort results by
   *
   * @default "tvlUSD"
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
 * User-provided role annotation echoed onto a pool result.
 *
 * Carries the user's intended base/quote orientation derived from the
 * search request (or echoed from the pool detail endpoint). Pool itself
 * remains role-agnostic — this is purely query-side metadata.
 */
export interface PoolUserProvidedInfo {
  /**
   * Whether the pool's `token0` is the quote side from the user's perspective.
   *
   * `true` → token0 = quote, token1 = base
   * `false` → token0 = base, token1 = quote
   */
  isToken0Quote: boolean;
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

  /**
   * Pool metrics — TVL, volume, fees, fee-APR, volatility, and σ-filter
   * verdict. See `PoolMetricsBlock` for the full schema.
   */
  metrics: PoolMetricsBlock;

  /**
   * Whether this pool is in user's favorites
   *
   * Only populated when user is authenticated.
   * undefined/missing when not authenticated.
   */
  isFavorite?: boolean;

  /**
   * User-provided role annotation derived from the search request's
   * `quote` array. Indicates which of `token0`/`token1` the user intends
   * as the quote side, allowing consumers to render pairs in user-intended
   * orientation regardless of pool-native token order.
   */
  userProvidedInfo?: PoolUserProvidedInfo;
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
 * Canonicalize a `base` / `quote` entry for verbatim equality comparison.
 * - Addresses: EIP-55 normalized.
 * - Symbols: uppercased (case-insensitive compare).
 */
function canonicalizeTokenInput(input: string): string {
  if (isValidAddress(input)) {
    return normalizeAddress(input);
  }
  return input.toUpperCase();
}

/**
 * POST /api/v1/pools/uniswapv3/search - Request validation
 *
 * Trivial-case rejection: rejects only `|base| = |quote| = 1 ∧ base[0] === quote[0]`
 * (after EIP-55 normalize for addresses, case-insensitive compare for symbols).
 * Richer queries like `base=["WETH","stETH"], quote=["WETH","stETH"]` pass and
 * are handled at the service layer with per-chain self-exclusion.
 */
export const PoolSearchRequestSchema = z
  .object({
    base: z
      .array(z.string().min(1, 'Token cannot be empty'))
      .min(1, 'base must have at least one token')
      .max(10, 'base cannot have more than 10 tokens'),

    quote: z
      .array(z.string().min(1, 'Token cannot be empty'))
      .min(1, 'quote must have at least one token')
      .max(10, 'quote cannot have more than 10 tokens'),

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
      .enum([
        'tvlUSD',
        'volume24hUSD',
        'fees24hUSD',
        'volume7dAvgUSD',
        'fees7dAvgUSD',
        'apr7d',
      ])
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
  })
  .refine(
    (data) => {
      if (data.base.length !== 1 || data.quote.length !== 1) return true;
      return canonicalizeTokenInput(data.base[0]!) !== canonicalizeTokenInput(data.quote[0]!);
    },
    {
      message:
        'base and quote cannot be the same single token. Provide at least one differing token to express the desired pair.',
      path: ['quote'],
    }
  );

/**
 * Inferred type from schema (for runtime validation)
 */
export type PoolSearchRequestValidated = z.infer<typeof PoolSearchRequestSchema>;
