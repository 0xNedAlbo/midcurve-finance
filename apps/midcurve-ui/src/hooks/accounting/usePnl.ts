import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { PnlResponse, PeriodQuery } from '@midcurve/api-shared';

export function usePnl(period: PeriodQuery) {
  return useQuery({
    queryKey: queryKeys.accounting.pnl(period),
    queryFn: async () => {
      const response = await apiClient.get<PnlResponse>(
        `/api/v1/accounting/pnl?period=${period}`,
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
