import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { BalanceSheetResponse, PeriodQuery } from '@midcurve/api-shared';

export function useBalanceSheet(period: PeriodQuery) {
  return useQuery({
    queryKey: queryKeys.accounting.balanceSheet(period),
    queryFn: async () => {
      const response = await apiClient.get<BalanceSheetResponse>(
        `/api/v1/accounting/balance-sheet?period=${period}`,
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
