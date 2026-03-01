import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { PnlResponse, PeriodQuery } from '@midcurve/api-shared';

export function usePnl(period: PeriodQuery, offset: number = 0) {
  return useQuery({
    queryKey: queryKeys.accounting.pnl(period, offset),
    queryFn: async () => {
      const response = await apiClient.get<PnlResponse>(
        `/api/v1/accounting/pnl?period=${period}&offset=${offset}`,
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
