/**
 * usePositionsList - Platform-agnostic position list hook
 *
 * Fetches paginated list of positions across all protocols.
 * Supports filtering by protocol, status, and sorting options.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type {
  ListPositionsParams,
  ListPositionsResponse,
} from '@midcurve/api-shared';

export function usePositionsList(
  params?: ListPositionsParams,
  options?: Omit<UseQueryOptions<ListPositionsResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.positions.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      if (params?.protocols && params.protocols.length > 0) {
        searchParams.set('protocols', params.protocols.join(','));
      }
      if (params?.status) {
        searchParams.set('status', params.status);
      }
      if (params?.sortBy) {
        searchParams.set('sortBy', params.sortBy);
      }
      if (params?.sortDirection) {
        searchParams.set('sortDirection', params.sortDirection);
      }
      if (params?.limit !== undefined) {
        searchParams.set('limit', params.limit.toString());
      }
      if (params?.offset !== undefined) {
        searchParams.set('offset', params.offset.toString());
      }

      const url = `/api/v1/positions/list${
        searchParams.toString() ? `?${searchParams}` : ''
      }`;

      return apiClient<ListPositionsResponse>(url);
    },
    staleTime: 30_000, // 30 seconds (positions change frequently)
    ...options,
  });
}
