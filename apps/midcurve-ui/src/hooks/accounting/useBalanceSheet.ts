import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { BalanceSheetResponse, PeriodQuery } from '@midcurve/api-shared';

export function useBalanceSheet(period: PeriodQuery, offset: number = 0) {
  return useQuery({
    queryKey: queryKeys.accounting.balanceSheet(period, offset),
    queryFn: async () => {
      const response = await apiClient.get<BalanceSheetResponse>(
        `/api/v1/accounting/balance-sheet?period=${period}&offset=${offset}`,
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
