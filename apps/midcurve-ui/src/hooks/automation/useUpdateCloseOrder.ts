/**
 * useUpdateCloseOrder - Update close order price thresholds
 *
 * Mutation hook for updating an existing close order's trigger prices
 * or slippage settings. Updates require on-chain transaction.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, automationApi } from '@/lib/api-client';
import type { UpdateCloseOrderRequest, SerializedCloseOrder } from '@midcurve/api-shared';

interface UpdateCloseOrderParams extends UpdateCloseOrderRequest {
  /**
   * Order ID to update
   */
  orderId: string;

  /**
   * Position ID for cache invalidation
   */
  positionId: string;
}

export function useUpdateCloseOrder(
  options?: Omit<
    UseMutationOptions<SerializedCloseOrder, ApiError, UpdateCloseOrderParams, unknown>,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: queryKeys.automation.mutations.updateOrder,

    mutationFn: async (params: UpdateCloseOrderParams): Promise<SerializedCloseOrder> => {
      const { orderId, positionId: _, ...updateData } = params;
      const response = await automationApi.updateCloseOrder(orderId, updateData);
      return response.data;
    },

    onSuccess: (_, params) => {
      // Invalidate close orders for this position
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.closeOrders.byPosition(params.positionId),
      });

      // Invalidate all close orders list
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.closeOrders.lists(),
      });

      // Invalidate specific order
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.closeOrders.detail(params.orderId),
      });
    },

    ...options,
  });
}
