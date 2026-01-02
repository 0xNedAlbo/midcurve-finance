/**
 * useCancelCloseOrder - Cancel an active close order
 *
 * Mutation hook for cancelling a close order. Only orders in
 * 'pending' or 'active' status can be cancelled.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, automationApi } from '@/lib/api-client';
import type { SerializedCloseOrder } from '@midcurve/api-shared';

interface CancelCloseOrderParams {
  /**
   * Order ID to cancel
   */
  orderId: string;

  /**
   * Position ID for cache invalidation
   */
  positionId: string;
}

export function useCancelCloseOrder(
  options?: Omit<
    UseMutationOptions<SerializedCloseOrder, ApiError, CancelCloseOrderParams, unknown>,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: queryKeys.automation.mutations.cancelOrder,

    mutationFn: async (params: CancelCloseOrderParams): Promise<SerializedCloseOrder> => {
      const response = await automationApi.cancelCloseOrder(params.orderId);
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
