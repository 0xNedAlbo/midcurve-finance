import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { NavTimelineResponse } from '@midcurve/api-shared';

export function useNavTimeline(days = 90) {
  return useQuery({
    queryKey: queryKeys.accounting.navTimeline(days),
    queryFn: async () => {
      const response = await apiClient.get<NavTimelineResponse>(
        `/api/v1/accounting/nav-timeline?days=${days}`,
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
