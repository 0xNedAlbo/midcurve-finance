/**
 * useSwitchQuoteToken - React Query hook for switching quote/base token
 *
 * Flips the quote/base token assignment for a position and triggers
 * a full ledger rebuild. This is a long-running operation (up to 60s).
 *
 * Uses a per-position mutation key so `useIsMutating` works natively
 * for tracking in-flight switches without manual cache scanning.
 *
 * Usage:
 * ```typescript
 * const switchQuoteToken = useSwitchQuoteToken(position.positionHash);
 * switchQuoteToken.mutate({ endpoint });
 *
 * // In another component — check if this position is switching:
 * const isSwitching = useIsMutating({
 *   mutationKey: switchQuoteTokenMutationKey(position.positionHash),
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

interface SwitchQuoteTokenParams {
  endpoint: string; // Protocol-specific switch-quote-token endpoint
}

type SerializedPosition = BigIntToString<UniswapV3Position>;

/**
 * Builds the mutation key for a specific position's switch-quote-token operation.
 */
export const switchQuoteTokenMutationKey = (positionHash: string) =>
  ['positions', 'switch-quote-token', positionHash] as const;

/**
 * Hook to switch the quote/base token assignment for a position
 *
 * @param positionHash - Unique position identifier (e.g. "uniswapv3/1/12345")
 *
 * Returns the refreshed position with all recalculated metrics.
 */
export function useSwitchQuoteToken(
  positionHash: string,
  options?: Omit<
    UseMutationOptions<SerializedPosition, ApiError, SwitchQuoteTokenParams>,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: switchQuoteTokenMutationKey(positionHash),

    mutationFn: async ({ endpoint }: SwitchQuoteTokenParams) => {
      const result = await apiClient.post<SerializedPosition>(endpoint, {});
      return result.data;
    },

    onSuccess: async () => {
      // Invalidate position list cache to trigger refetch
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.lists(),
      });

      // Invalidate all position detail caches
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.all,
      });
    },

    onError: (error) => {
      console.error('Failed to switch quote token:', error);
    },

    ...options,
  });
}
