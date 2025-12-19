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
import { apiClientFn, ApiError } from '@/lib/api-client';
import { updatePositionInListCache } from '@/lib/update-position-in-list-cache';
import type {
  UpdateUniswapV3PositionRequest,
  UpdateUniswapV3PositionData,
} from '@midcurve/api-shared';

interface UpdatePositionWithEventsParams {
  chainId: number;
  nftId: string;
  events: UpdateUniswapV3PositionRequest['events'];
}

export function useUpdatePositionWithEvents(
  options?: Omit<
    UseMutationOptions<
      UpdateUniswapV3PositionData,
      ApiError,
      UpdatePositionWithEventsParams,
      unknown
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  // Extract user's onSuccess callback before spreading options
  const userOnSuccess = options?.onSuccess;

  return useMutation({
    ...options,

    mutationFn: async (params: UpdatePositionWithEventsParams) => {
      const requestBody: UpdateUniswapV3PositionRequest = {
        events: params.events,
      };

      return apiClientFn<UpdateUniswapV3PositionData>(
        `/api/v1/positions/uniswapv3/${params.chainId}/${params.nftId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );
    },

    onSuccess: async (response, variables, context, meta) => {
      // apiClient already unwraps the response data field, so response IS the position data
      const updatedPosition = response;

      // Step 1: Update position in ALL list caches (instant UI update)
      updatePositionInListCache(queryClient, updatedPosition);

      // Step 2: Invalidate position detail (if user is viewing it)
      // This triggers a background refetch but doesn't block the UI
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.detail(
          updatedPosition.config.chainId,
          updatedPosition.config.nftId.toString()
        ),
      });

      // Step 3: Call user's onSuccess handler if provided
      if (userOnSuccess) {
        await userOnSuccess(updatedPosition, variables, context, meta);
      }
    },
  });
}
