/**
 * usePositionsList - Platform-agnostic position list hook
 *
 * Fetches paginated list of positions across all protocols.
 * Returns common fields for sorting/filtering and positionHash for protocol dispatch.
 * Does NOT return protocol-specific data — each card fetches its own detail.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
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

      const API_BASE_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE_URL}${url}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || 'Failed to fetch positions');
      }

      return response.json() as Promise<ListPositionsResponse>;
    },
    staleTime: 30_000,
    ...options,
  });
}
