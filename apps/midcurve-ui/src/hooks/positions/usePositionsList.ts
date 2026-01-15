/**
 * usePositionsList - Platform-agnostic position list hook
 *
 * Fetches paginated list of positions across all protocols.
 * Supports filtering by protocol, status, and sorting options.
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

      // Include PnL curve data by default for mini curve visualization
      // Can be overridden by explicitly passing includePnLCurve: false
      const includePnLCurve = params?.includePnLCurve ?? true;
      searchParams.set('includePnLCurve', includePnLCurve.toString());

      const url = `/api/v1/positions/list${
        searchParams.toString() ? `?${searchParams}` : ''
      }`;

      // ListPositionsResponse is a PaginatedResponse which has its own structure:
      // { success, data: T[], pagination, meta }
      // We need to fetch the raw response, not use apiClient which unwraps .data
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
    staleTime: 30_000, // 30 seconds (positions change frequently)
    ...options,
  });
}
