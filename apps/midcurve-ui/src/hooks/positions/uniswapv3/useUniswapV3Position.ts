/**
 * useUniswapV3Position - Fetch single Uniswap V3 position by chainId + nftId
 *
 * Polls the DB-only GET endpoint every 3 seconds to pick up background
 * state changes (liquidity events, deposits, withdrawals, closures).
 * On-chain refresh is handled separately by useUniswapV3AutoRefresh (60s).
 *
 * Supports `initialData` option to show placeholder data (from list query)
 * immediately while fresh data loads in the background.
 *
 * @param chainId - Chain ID where position exists
 * @param nftId - NFT ID of the position
 * @param options - React Query options, including initialData for placeholder
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
    staleTime: 2_000, // 2 seconds
    refetchInterval: 3_000, // Poll DB every 3 seconds for background changes
    ...options,
  });
}
