/**
 * React Query Hook for Uniswap V3 Position APR Periods
 *
 * Fetches the complete history of APR periods for a Uniswap V3 position,
 * showing fee collection performance over time, plus a pre-calculated summary.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AprPeriodsResponse } from '@midcurve/api-shared';

/**
 * Fetch APR periods and summary for a Uniswap V3 position
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The NFT Position Manager token ID
 * @returns React Query result with full APR response (periods array + summary)
 *
 * Response structure:
 * - data: AprPeriodData[] - Array of periods (sorted descending by startTimestamp)
 * - summary: AprSummaryData - Pre-calculated APR metrics (realized + unrealized + total)
 * - meta: { timestamp, count, requestId }
 */
export function useUniswapV3AprPeriods(
  chainId: number,
  nftId: string
): UseQueryResult<AprPeriodsResponse, Error> {
  return useQuery<AprPeriodsResponse, Error>({
    queryKey: ['uniswapv3-apr-periods', chainId, nftId],
    queryFn: async () => {
      // Fetch full response (not just data array)
      const response = await fetch(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/apr`
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          message: 'Failed to fetch APR periods',
        }));
        throw new Error(error.message || 'Failed to fetch APR periods');
      }

      return response.json();
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 60 * 1000, // 1 minute (renamed from cacheTime in React Query v5)
  });
}
