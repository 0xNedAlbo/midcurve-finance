import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { BalanceSheetResponse } from '@midcurve/api-shared';

export function useBalanceSheet() {
  return useQuery({
    queryKey: queryKeys.accounting.balanceSheet(),
    queryFn: async () => {
      const response = await apiClient.get<BalanceSheetResponse>(
        '/api/v1/accounting/balance-sheet',
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
