/**
 * useStrategiesList - Strategy list hook
 *
 * Fetches paginated list of user's strategies with computed metrics.
 * Supports filtering by state, strategy type, and sorting options.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type {
  ListStrategiesParams,
  ListStrategiesResponse,
} from '@midcurve/api-shared';

export function useStrategiesList(
  params?: ListStrategiesParams,
  options?: Omit<UseQueryOptions<ListStrategiesResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.strategies.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      if (params?.state) {
        searchParams.set('state', params.state);
      }
      if (params?.strategyType) {
        searchParams.set('strategyType', params.strategyType);
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
      if (params?.includePositions) {
        searchParams.set('includePositions', 'true');
      }
      if (params?.includeWallets) {
        searchParams.set('includeWallets', 'true');
      }

      const url = `/api/v1/strategies/list${
        searchParams.toString() ? `?${searchParams}` : ''
      }`;

      const API_BASE_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE_URL}${url}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || 'Failed to fetch strategies');
      }

      return response.json() as Promise<ListStrategiesResponse>;
    },
    staleTime: 30_000, // 30 seconds
    ...options,
  });
}
