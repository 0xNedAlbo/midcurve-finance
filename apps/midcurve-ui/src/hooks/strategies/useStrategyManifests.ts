/**
 * useStrategyManifests - Fetch available strategy manifests
 *
 * Fetches list of strategy manifests (templates) that users can deploy.
 * Supports filtering by active status and tags.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import type { ListManifestsResponse } from '@midcurve/api-shared';

export interface UseStrategyManifestsParams {
  /** Filter by active status (default: true) */
  isActive?: boolean;
  /** Filter by tags (OR logic) */
  tags?: string[];
}

export function useStrategyManifests(
  params?: UseStrategyManifestsParams,
  options?: Omit<UseQueryOptions<ListManifestsResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.strategies.manifests.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      // Default to active manifests only
      if (params?.isActive !== undefined) {
        searchParams.set('isActive', String(params.isActive));
      } else {
        searchParams.set('isActive', 'true');
      }

      if (params?.tags && params.tags.length > 0) {
        searchParams.set('tags', params.tags.join(','));
      }

      const url = `/api/v1/strategies/manifests${
        searchParams.toString() ? `?${searchParams}` : ''
      }`;

      return apiClient<ListManifestsResponse>(url);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (manifests change rarely)
    ...options,
  });
}
