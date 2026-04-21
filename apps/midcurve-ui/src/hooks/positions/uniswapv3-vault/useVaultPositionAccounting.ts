/**
 * useVaultPositionAccounting - Fetch lifetime-to-date accounting report for a
 * tokenized Uniswap V3 vault position.
 *
 * Returns the full balance sheet, realized P&L breakdown, and journal entry
 * audit trail in one payload.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';
import type { PositionAccountingResponse } from '@midcurve/api-shared';

export function useVaultPositionAccounting(
  chainId: number,
  vaultAddress: string,
  ownerAddress: string
) {
  return useQuery({
    queryKey: queryKeys.positions.uniswapv3Vault.accounting(chainId, vaultAddress, ownerAddress),
    queryFn: async () =>
      apiClientFn<PositionAccountingResponse>(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}/accounting`
      ),
    staleTime: 60_000,
  });
}
