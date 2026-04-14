/**
 * useUniswapV3VaultPosition - Fetch single vault position by chainId + vaultAddress + ownerAddress
 *
 * Polls the DB-only GET endpoint every 3 seconds to pick up background
 * state changes. On-chain refresh is handled separately by useUniswapV3VaultAutoRefresh (60s).
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';
import type { GetUniswapV3VaultPositionResponse } from '@midcurve/api-shared';

export type UniswapV3VaultPositionData = GetUniswapV3VaultPositionResponse;

export function useUniswapV3VaultPosition(
  chainId: number,
  vaultAddress: string,
  ownerAddress: string,
  options?: Omit<UseQueryOptions<GetUniswapV3VaultPositionResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.positions.uniswapv3Vault.detail(chainId, vaultAddress, ownerAddress),
    queryFn: async () => {
      return apiClientFn<GetUniswapV3VaultPositionResponse>(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`
      );
    },
    staleTime: 2_000,
    refetchInterval: 3_000,
    ...options,
  });
}
