/**
 * usePoolSearch Hook
 *
 * React Query hook for searching Uniswap V3 pools by base/quote token sets.
 * Returns pools annotated with `userProvidedInfo.isToken0Quote` (derived
 * from the quote-side input) and `isFavorite` for authenticated users.
 *
 * Usage:
 * ```tsx
 * const { pools, isLoading, error } = usePoolSearch({
 *   base: ['WETH', 'stETH'],
 *   quote: ['USDC', 'USDT'],
 *   chainIds: [1, 42161],
 *   sortBy: 'apr7d',
 *   limit: 20,
 * });
 * ```
 */

import { useQuery } from '@tanstack/react-query';
import type { PoolSearchResultItem, PoolSearchResponse } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Search parameters for pool search.
 *
 * `base`/`quote` accept exact token symbols (case-insensitive — must match a
 * CoinGecko symbol exactly) or EIP-55 addresses. Fuzzy/prefix resolution is
 * the consumer's responsibility (the token picker upstream handles it).
 */
export interface PoolSearchParams {
  /**
   * Base side of the pair.
   * @example ["WETH", "stETH"]
   */
  base: string[];

  /**
   * Quote side of the pair. Determines `userProvidedInfo.isToken0Quote`
   * on each result.
   * @example ["USDC", "USDT"]
   */
  quote: string[];

  /**
   * Chain IDs to search on
   * @example [1, 42161]
   */
  chainIds: number[];

  /**
   * Field to sort results by
   * @default "tvlUSD"
   */
  sortBy?: 'tvlUSD' | 'volume24hUSD' | 'fees24hUSD' | 'apr7d';

  /**
   * Sort direction
   * @default "desc"
   */
  sortDirection?: 'asc' | 'desc';

  /**
   * Maximum results to return
   * @default 20
   * @max 100
   */
  limit?: number;
}

/**
 * Hook props
 */
export interface UsePoolSearchProps extends PoolSearchParams {
  /**
   * Enable/disable the query
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook return type
 */
export interface UsePoolSearchReturn {
  /**
   * Array of pool search results
   * Includes isFavorite status for each pool
   */
  pools: PoolSearchResultItem[];

  /**
   * Whether the query is currently loading
   */
  isLoading: boolean;

  /**
   * Whether the query resulted in an error
   */
  isError: boolean;

  /**
   * Error message if query failed
   */
  error: string | null;

  /**
   * Manually refetch the search results
   */
  refetch: () => Promise<void>;
}

/**
 * React Query hook for searching Uniswap V3 pools
 *
 * Features:
 * - Multi-chain search
 * - Symbol or address input (exact match — see PoolSearchParams)
 * - Favorite status enrichment
 * - Per-result `userProvidedInfo.isToken0Quote` orientation
 * - Sorting by various metrics
 *
 * @param props - Search parameters
 * @returns Pool search results and query state
 */
export function usePoolSearch({
  base,
  quote,
  chainIds,
  sortBy = 'tvlUSD',
  sortDirection = 'desc',
  limit = 20,
  enabled = true,
}: UsePoolSearchProps): UsePoolSearchReturn {
  // Only enable query when both token sets have at least one token
  const hasValidInput = base.length > 0 && quote.length > 0 && chainIds.length > 0;

  const query = useQuery({
    queryKey: queryKeys.pools.uniswapv3.search({
      base,
      quote,
      chainIds,
      sortBy,
      limit,
    }),
    queryFn: async () => {
      const response = await apiClient.post<PoolSearchResponse['data']>(
        '/api/v1/pools/uniswapv3/search',
        {
          base,
          quote,
          chainIds,
          sortBy,
          sortDirection,
          limit,
        }
      );
      return response.data;
    },
    enabled: enabled && hasValidInput,
    staleTime: 30000, // 30 seconds
    gcTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    pools: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error?.message ?? null,
    refetch: async () => {
      await query.refetch({ cancelRefetch: true });
    },
  };
}
