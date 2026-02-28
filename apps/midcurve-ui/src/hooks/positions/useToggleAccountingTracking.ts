/**
 * useToggleAccountingTracking - Toggle accounting tracking for a position
 *
 * Calls POST /api/v1/accounting/tracked-instruments to toggle whether
 * a position is tracked in the accounting system (journal entries).
 *
 * Uses a per-position mutation key so `useIsMutating` works natively.
 */

import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient, type ApiError } from '@/lib/api-client';
import type { ToggleTrackingResponse } from '@midcurve/api-shared';

interface ToggleAccountingTrackingParams {
  positionHash: string;
}

export const toggleAccountingTrackingMutationKey = (positionHash: string) =>
  ['positions', 'toggle-accounting-tracking', positionHash] as const;

export function useToggleAccountingTracking(
  positionHash: string,
  chainId: number,
  nftId: string
) {
  const queryClient = useQueryClient();

  return useMutation<ToggleTrackingResponse, ApiError, ToggleAccountingTrackingParams>({
    mutationKey: toggleAccountingTrackingMutationKey(positionHash),

    mutationFn: async ({ positionHash }: ToggleAccountingTrackingParams) => {
      const result = await apiClient.post<ToggleTrackingResponse>(
        '/api/v1/accounting/tracked-instruments',
        { positionHash }
      );
      return result.data;
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.detail(chainId, nftId),
      });
    },
  });
}
