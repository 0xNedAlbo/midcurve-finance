/**
 * useDiscoverPositions - Scan wallet for positions across selected chains
 *
 * Mutation hook that triggers position discovery via the blocking
 * POST /api/v1/positions/discover endpoint. Invalidates the position
 * list query on success so newly imported positions appear immediately.
 */

import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn, type ApiError } from '@/lib/api-client';
import type { DiscoverPositionsData } from '@midcurve/api-shared';

interface DiscoverPositionsParams {
  chainIds?: number[];
}

export function useDiscoverPositions() {
  const queryClient = useQueryClient();

  return useMutation<DiscoverPositionsData, ApiError, DiscoverPositionsParams>({
    mutationFn: async (params: DiscoverPositionsParams) => {
      return apiClientFn<DiscoverPositionsData>(
        '/api/v1/positions/discover',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chainIds: params.chainIds,
          }),
        },
      );
    },

    onSuccess: () => {
      // Invalidate position lists to show newly discovered positions
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.lists(),
      });
    },
  });
}
