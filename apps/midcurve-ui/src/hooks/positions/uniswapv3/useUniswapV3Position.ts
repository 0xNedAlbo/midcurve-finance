/**
 * useUniswapV3Position - Fetch single Uniswap V3 position by chainId + nftId
 *
 * Platform-specific query hook for fetching detailed position data.
 * Returns fresh on-chain state merged with database records.
 *
 * Supports `initialData` option to show placeholder data (from list query)
 * immediately while fresh data loads in the background.
 *
 * @param chainId - Chain ID where position exists
 * @param nftId - NFT ID of the position
 * @param options - React Query options, including initialData for placeholder
 *
 * @example
 * ```tsx
 * // With initial data from list query (no loading skeleton)
 * const { data: position } = useUniswapV3Position(1, '12345', {
 *   initialData: listPositionData,
 * });
 * ```
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';
import type { GetUniswapV3PositionResponse } from '@midcurve/api-shared';

/**
 * UI-specific type alias for Uniswap V3 position data.
 *
 * Use this instead of `GetUniswapV3PositionResponse` or `ListPositionData`
 * when typing component props that receive position data.
 */
export type UniswapV3PositionData = GetUniswapV3PositionResponse;

export function useUniswapV3Position(
  chainId: number,
  nftId: string,
  options?: Omit<UseQueryOptions<GetUniswapV3PositionResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.positions.uniswapv3.detail(chainId, nftId),
    queryFn: async () => {
      return apiClientFn<GetUniswapV3PositionResponse>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}`
      );
    },
    staleTime: 60_000, // 1 minute (position details change less frequently)
    refetchInterval: 60_000, // Auto-refresh every 60 seconds
    ...options,
  });
}
