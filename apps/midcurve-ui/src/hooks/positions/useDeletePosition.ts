/**
 * useDeletePosition - React Query hook for deleting positions
 *
 * Uses a per-position mutation key so `useIsMutating` works natively
 * for tracking in-flight deletions without manual cache scanning.
 *
 * Usage:
 * ```typescript
 * const deletePosition = useDeletePosition(position.positionHash);
 * deletePosition.mutate({ endpoint });
 *
 * // In another component — check if this position is being deleted:
 * const isDeleting = useIsMutating({
 *   mutationKey: deletePositionMutationKey(position.positionHash),
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

interface DeletePositionParams {
  endpoint: string; // Protocol-specific DELETE endpoint
}

/**
 * Builds the mutation key for a specific position's delete operation.
 */
export const deletePositionMutationKey = (positionHash: string) =>
  ['positions', 'delete', positionHash] as const;

/**
 * Hook to delete a position
 *
 * @param positionHash - Unique position identifier (e.g. "uniswapv3/1/12345")
 */
export function useDeletePosition(
  positionHash: string,
  options?: Omit<
    UseMutationOptions<void, ApiError, DeletePositionParams>,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: deletePositionMutationKey(positionHash),

    mutationFn: async ({ endpoint }: DeletePositionParams) => {
      await apiClient.delete(endpoint);
    },

    onSuccess: async () => {
      // Wait for cache invalidation and refetch to complete
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.lists(),
      });
    },

    onError: (error) => {
      // Error is handled by the component UI
      console.error('Failed to delete position:', error);
    },

    ...options,
  });
}
