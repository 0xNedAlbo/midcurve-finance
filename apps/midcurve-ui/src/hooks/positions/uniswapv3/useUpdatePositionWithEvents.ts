/**
 * useUpdatePositionWithEvents - Update Uniswap V3 position with ledger events
 *
 * Calls the existing PATCH endpoint to append new events to a position's ledger
 * after executing on-chain transactions (INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, COLLECT).
 *
 * The backend will:
 * - Validate event ordering
 * - Add events to the position ledger
 * - Recalculate position state and financial fields
 * - Return the updated position
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient, ApiError } from '@/lib/api-client';
import type {
  UpdateUniswapV3PositionRequest,
  UpdateUniswapV3PositionResponse,
} from '@midcurve/api-shared';

interface UpdatePositionWithEventsParams {
  chainId: number;
  nftId: string;
  events: UpdateUniswapV3PositionRequest['events'];
}

export function useUpdatePositionWithEvents(
  options?: Omit<
    UseMutationOptions<
      UpdateUniswapV3PositionResponse,
      ApiError,
      UpdatePositionWithEventsParams,
      unknown
    >,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,

    mutationFn: async (params: UpdatePositionWithEventsParams) => {
      const requestBody: UpdateUniswapV3PositionRequest = {
        events: params.events,
      };

      return apiClient<UpdateUniswapV3PositionResponse>(
        `/api/v1/positions/uniswapv3/${params.chainId}/${params.nftId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );
    },

    onSuccess: async (response) => {
      // apiClient already unwraps the response data field
      const updatedPosition = response.data;

      // Debug logging for position data
      console.log('[useUpdatePositionWithEvents] Updated position:', {
        id: updatedPosition.id,
        realizedPnl: updatedPosition.realizedPnl,
        unrealizedPnl: updatedPosition.unrealizedPnl,
        collectedFees: updatedPosition.collectedFees,
        unClaimedFees: updatedPosition.unClaimedFees,
      });

      // Invalidate position detail (if user is viewing it)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.detail(
          updatedPosition.config.chainId,
          updatedPosition.config.nftId.toString()
        ),
      });
    },
  });
}
