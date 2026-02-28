import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { PeriodComparisonResponse, PeriodQuery } from '@midcurve/api-shared';

export function usePeriodComparison(period: PeriodQuery) {
  return useQuery({
    queryKey: queryKeys.accounting.periodComparison(period),
    queryFn: async () => {
      const response = await apiClient.get<PeriodComparisonResponse>(
        `/api/v1/accounting/period-comparison?period=${period}`,
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
