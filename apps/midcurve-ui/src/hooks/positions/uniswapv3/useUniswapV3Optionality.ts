/**
 * React Query Hook for Uniswap V3 Position Optionality View
 *
 * Fetches the optionality summary for a Uniswap V3 position.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OptionalitySummaryData } from '@midcurve/api-shared';
import { apiClientFn } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Fetch optionality summary for a Uniswap V3 position
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The NFT Position Manager token ID
 * @returns React Query result with optionality summary
 */
export function useUniswapV3Optionality(
  chainId: number,
  nftId: string
): UseQueryResult<OptionalitySummaryData, Error> {
  return useQuery<OptionalitySummaryData, Error>({
    queryKey: queryKeys.positions.uniswapv3.optionality(chainId, nftId),
    queryFn: async () => {
      return apiClientFn<OptionalitySummaryData>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/optionality`
      );
    },
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  });
}
