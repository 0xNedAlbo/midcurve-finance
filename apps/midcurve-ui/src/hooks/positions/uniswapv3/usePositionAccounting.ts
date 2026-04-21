/**
 * usePositionAccounting - Fetch lifetime-to-date accounting report for a
 * Uniswap V3 NFT position.
 *
 * Returns the full balance sheet, realized P&L breakdown, and journal entry
 * audit trail in one payload.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';
import type { PositionAccountingResponse } from '@midcurve/api-shared';

export function usePositionAccounting(chainId: number, nftId: string) {
  return useQuery({
    queryKey: queryKeys.positions.uniswapv3.accounting(chainId, nftId),
    queryFn: async () =>
      apiClientFn<PositionAccountingResponse>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/accounting`
      ),
    staleTime: 60_000,
  });
}
