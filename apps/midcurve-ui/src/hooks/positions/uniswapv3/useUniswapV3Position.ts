/**
 * useUniswapV3Position - Fetch single Uniswap V3 position by chainId + nftId
 *
 * Platform-specific query hook for fetching detailed position data.
 * Returns fresh on-chain state merged with database records.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { GetUniswapV3PositionResponse } from '@midcurve/api-shared';

export function useUniswapV3Position(
  chainId: number,
  nftId: string,
  options?: Omit<UseQueryOptions<GetUniswapV3PositionResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.positions.uniswapv3.detail(chainId, nftId),
    queryFn: async () => {
      return apiClient<GetUniswapV3PositionResponse>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}`
      );
    },
    staleTime: 60_000, // 1 minute (position details change less frequently)
    refetchInterval: 60_000, // Auto-refresh every 60 seconds
    ...options,
  });
}
