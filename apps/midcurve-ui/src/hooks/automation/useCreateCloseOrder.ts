/**
 * useCreateCloseOrder - Create a new close order with polling
 *
 * Mutation hook for creating a close order. The API returns 202 Accepted
 * and this hook polls until the order is registered or fails.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, automationApi } from '@/lib/api-client';
import type {
  RegisterCloseOrderRequest,
  RegisterCloseOrderResponseData,
  CloseOrderRegistrationStatus,
  SerializedCloseOrder,
} from '@midcurve/api-shared';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the order status endpoint until registration completes or fails
 */
async function pollForOrderRegistration(
  orderId: string,
  maxAttempts = 60,
  intervalMs = 2000
): Promise<SerializedCloseOrder> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    const response = await automationApi.getCloseOrderStatus(orderId);
    const status = response.data as CloseOrderRegistrationStatus;

    // Check if completed
    if (status.operationStatus === 'completed' && status.order) {
      return status.order;
    }

    // Check if failed
    if (status.operationStatus === 'failed') {
      throw new ApiError(
        status.operationError || 'Close order registration failed',
        500,
        'ORDER_REGISTRATION_FAILED'
      );
    }

    // Still in progress (pending or registering), continue polling
  }

  throw new ApiError(
    'Close order registration timed out',
    408,
    'ORDER_REGISTRATION_TIMEOUT'
  );
}

export interface CreateCloseOrderResult {
  /**
   * The created order (after registration completes)
   */
  order: SerializedCloseOrder;

  /**
   * Position ID for cache invalidation
   */
  positionId: string;
}

export function useCreateCloseOrder(
  options?: Omit<
    UseMutationOptions<CreateCloseOrderResult, ApiError, RegisterCloseOrderRequest, unknown>,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: queryKeys.automation.mutations.createOrder,

    mutationFn: async (input: RegisterCloseOrderRequest): Promise<CreateCloseOrderResult> => {
      // Initial request - starts the registration
      const response = await automationApi.createCloseOrder(input);
      const data = response.data as RegisterCloseOrderResponseData;

      // If somehow already completed (shouldn't happen), fetch the order
      if (data.operationStatus === 'completed') {
        const orderResponse = await automationApi.getCloseOrder(data.id);
        return {
          order: orderResponse.data,
          positionId: input.positionId,
        };
      }

      // If failed immediately
      if (data.operationStatus === 'failed') {
        throw new ApiError(
          'Close order registration failed',
          500,
          'ORDER_REGISTRATION_FAILED'
        );
      }

      // Poll until registration completes
      const order = await pollForOrderRegistration(data.id);

      return {
        order,
        positionId: input.positionId,
      };
    },

    onSuccess: (result) => {
      // Invalidate close orders for this position
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.closeOrders.byPosition(result.positionId),
      });

      // Invalidate all close orders list
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.closeOrders.lists(),
      });
    },

    ...options,
  });
}
