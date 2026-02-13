/**
 * useReloadPositionHistory - React Query hook for reloading position history
 *
 * Completely rebuilds a position's event history from the blockchain.
 * This is a destructive operation that deletes all existing ledger events,
 * APR periods, and sync state, then refetches everything from scratch.
 *
 * Uses a per-position mutation key so `useIsMutating` works natively
 * for tracking in-flight reloads without manual cache scanning.
 *
 * Usage:
 * ```typescript
 * const reloadHistory = useReloadPositionHistory(position.positionHash);
 * reloadHistory.mutate({ endpoint });
 *
 * // In another component — check if this position is reloading:
 * const isReloading = useIsMutating({
 *   mutationKey: reloadPositionHistoryMutationKey(position.positionHash),
 * }) > 0;
 * ```
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient, ApiError } from '@/lib/api-client';
import type { UniswapV3Position } from '@midcurve/shared';
import type { BigIntToString } from '@midcurve/api-shared';

interface ReloadPositionHistoryParams {
  endpoint: string; // Protocol-specific reload-history endpoint
}

type SerializedPosition = BigIntToString<UniswapV3Position>;

/**
 * Builds the mutation key for a specific position's reload-history operation.
 */
export const reloadPositionHistoryMutationKey = (positionHash: string) =>
  ['positions', 'reload-history', positionHash] as const;

/**
 * Hook to reload a position's entire history from the blockchain
 *
 * @param positionHash - Unique position identifier (e.g. "uniswapv3/1/12345")
 *
 * Returns the refreshed position with all recalculated metrics.
 */
export function useReloadPositionHistory(
  positionHash: string,
  options?: Omit<
    UseMutationOptions<SerializedPosition, ApiError, ReloadPositionHistoryParams>,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: reloadPositionHistoryMutationKey(positionHash),

    mutationFn: async ({ endpoint }: ReloadPositionHistoryParams) => {
      const result = await apiClient.post<SerializedPosition>(endpoint, {});
      return result.data;
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
