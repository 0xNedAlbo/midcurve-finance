/**
 * React Query Hook for UniswapV3 Vault Position APR Periods
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AprPeriodsResponse } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function useUniswapV3VaultAprPeriods(
  chainId: number,
  vaultAddress: string,
  ownerAddress: string
): UseQueryResult<AprPeriodsResponse, Error> {
  return useQuery<AprPeriodsResponse, Error>({
    queryKey: queryKeys.positions.uniswapv3Vault.apr(chainId, vaultAddress, ownerAddress),
    queryFn: async () => {
      const response = await apiClient.get<AprPeriodsResponse>(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}/apr`
      );
      return response as unknown as AprPeriodsResponse;
    },
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  });
}
