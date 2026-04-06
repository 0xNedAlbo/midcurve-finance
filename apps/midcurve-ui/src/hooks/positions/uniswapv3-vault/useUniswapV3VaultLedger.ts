/**
 * React Query Hook for UniswapV3 Vault Position Ledger
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LedgerEventData } from '@midcurve/api-shared';
import { apiClientFn } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function useUniswapV3VaultLedger(
  chainId: number,
  vaultAddress: string
): UseQueryResult<LedgerEventData[], Error> {
  return useQuery<LedgerEventData[], Error>({
    queryKey: queryKeys.positions.uniswapv3Vault.ledger(chainId, vaultAddress),
    queryFn: async () => {
      return apiClientFn<LedgerEventData[]>(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/ledger`
      );
    },
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  });
}
