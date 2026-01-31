/**
 * usePoolLookup Hook
 *
 * React Query hook for looking up a pool by address across all supported chains.
 * Returns pools found with metrics and favorite status.
 *
 * Usage:
 * ```tsx
 * const { pools, isLoading, error } = usePoolLookup({
 *   address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
 * });
 * ```
 */

import { useQuery } from '@tanstack/react-query';
import type { PoolSearchResultItem, LookupPoolByAddressData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { isValidEthereumAddress } from '@/utils/evm';

/**
 * Hook props
 */
export interface UsePoolLookupProps {
  /**
   * Pool address to lookup across all chains
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  address: string;

  /**
   * Enable/disable the query
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook return type
 */
export interface UsePoolLookupReturn {
  /**
   * Array of pools found across chains
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
   * Manually refetch the lookup results
   */
  refetch: () => Promise<void>;
}

/**
 * React Query hook for looking up a pool by address across all chains
 *
 * Features:
 * - Multi-chain parallel search
 * - Favorite status enrichment
 * - Results sorted by TVL
 * - Address validation
 *
 * @param props - Lookup parameters
 * @returns Pool lookup results and query state
 */
export function usePoolLookup({
  address,
  enabled = true,
}: UsePoolLookupProps): UsePoolLookupReturn {
  // Only enable query when address is valid
  const isValidAddress = isValidEthereumAddress(address);

  const query = useQuery({
    queryKey: queryKeys.pools.uniswapv3.lookup(address),
    queryFn: async () => {
      const response = await apiClient.get<LookupPoolByAddressData>(
        `/api/v1/pools/uniswapv3/lookup?address=${encodeURIComponent(address)}`
      );
      return response.data;
    },
    enabled: enabled && isValidAddress,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    pools: query.data?.pools ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error?.message ?? null,
    refetch: async () => {
      await query.refetch({ cancelRefetch: true });
    },
  };
}
