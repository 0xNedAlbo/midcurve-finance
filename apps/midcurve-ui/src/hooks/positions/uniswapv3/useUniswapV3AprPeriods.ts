/**
 * React Query Hook for Uniswap V3 Position APR Periods
 *
 * Fetches the complete history of APR periods for a Uniswap V3 position,
 * showing fee collection performance over time.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AprPeriodData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/**
 * Fetch APR periods for a Uniswap V3 position
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The NFT Position Manager token ID
 * @returns React Query result with APR periods array (sorted by date descending)
 *
 * NOTE: apiClient automatically extracts the 'data' field from the response,
 * so this hook returns AprPeriodData[] directly (not AprPeriodsResponse)
 */
export function useUniswapV3AprPeriods(
  chainId: number,
  nftId: string
): UseQueryResult<AprPeriodData[], Error> {
  return useQuery<AprPeriodData[], Error>({
    queryKey: ['uniswapv3-apr-periods', chainId, nftId],
    queryFn: async () => {
      // apiClient extracts response.data automatically
      return apiClient<AprPeriodData[]>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/apr`
      );
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 60 * 1000, // 1 minute (renamed from cacheTime in React Query v5)
  });
}
