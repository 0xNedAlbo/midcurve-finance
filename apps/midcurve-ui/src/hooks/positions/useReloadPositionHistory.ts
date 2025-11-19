/**
 * useReloadPositionHistory - React Query hook for reloading position history
 *
 * Completely rebuilds a position's event history from the blockchain.
 * This is a destructive operation that deletes all existing ledger events,
 * APR periods, and sync state, then refetches everything from scratch.
 *
 * Usage:
 * ```typescript
 * const reloadHistory = useReloadPositionHistory({
 *   onSuccess: (position) => console.log('History reloaded', position),
 *   onError: (error) => console.error(error),
 * });
 *
 * const endpoint = `/api/v1/positions/uniswapv3/${chainId}/${nftId}/reload-history`;
 * reloadHistory.mutate({ endpoint, positionId: position.id });
 * ```
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError } from '@/lib/api-client';
import type { UniswapV3Position } from '@midcurve/shared';
import type { BigIntToString } from '@midcurve/api-shared';

interface ReloadPositionHistoryParams {
  endpoint: string; // Protocol-specific reload-history endpoint
  positionId: string; // For tracking and cache updates
}

type SerializedPosition = BigIntToString<UniswapV3Position>;

/**
 * Hook to reload a position's entire history from the blockchain
 *
 * Returns the refreshed position with all recalculated metrics.
 */
export function useReloadPositionHistory(
  options?: Omit<
    UseMutationOptions<SerializedPosition, ApiError, ReloadPositionHistoryParams>,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['positions', 'reload-history'] as const,

    mutationFn: async ({ endpoint }: ReloadPositionHistoryParams) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include', // Include session cookies
      });

      if (!response.ok) {
        const data = await response.json();
        throw new ApiError(
          data.error?.message || data.message || 'Failed to reload position history',
          response.status,
          data.error?.code || 'RELOAD_HISTORY_FAILED',
          data.error?.details
        );
      }

      // Parse response body - should contain refreshed position
      const result = await response.json();

      if (!result.data) {
        throw new ApiError(
          'Invalid response format: missing data field',
          500,
          'INVALID_RESPONSE',
          result
        );
      }

      return result.data as SerializedPosition;
    },

    onSuccess: async () => {
      // Invalidate position list cache to trigger refetch
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.lists(),
      });

      // Invalidate position detail cache
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.all,
      });
    },

    onError: (error) => {
      // Error is handled by the component UI
      console.error('Failed to reload position history:', error);
    },

    ...options,
  });
}

/**
 * Hook to get loading state for a specific position history reload
 *
 * Useful for showing loading states on specific position cards.
 *
 * @param positionId - Position ID to check
 * @returns true if position history is currently being reloaded
 */
export function useIsReloadingPositionHistory(positionId: string): boolean {
  const queryClient = useQueryClient();
  const mutationCache = queryClient.getMutationCache();

  // Check if there's an active reload-history mutation for this position
  const reloadMutations = mutationCache.findAll({
    mutationKey: ['positions', 'reload-history'],
    status: 'pending',
  });

  return reloadMutations.some((mutation) => {
    const variables = mutation.state.variables as
      | ReloadPositionHistoryParams
      | undefined;
    return variables?.positionId === positionId;
  });
}
