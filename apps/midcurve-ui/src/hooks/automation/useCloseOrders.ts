/**
 * useCloseOrders - Fetch close orders for a position
 *
 * Fetches close orders optionally filtered by position ID.
 * Supports polling for orders in pending/active states.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import type { SerializedCloseOrder, CloseOrderStatus } from '@midcurve/api-shared';

interface UseCloseOrdersParams {
  /**
   * Filter by position ID
   */
  positionId?: string;

  /**
   * Filter by status
   */
  status?: CloseOrderStatus;

  /**
   * Enable polling (for monitoring active orders)
   */
  polling?: boolean;
}

/**
 * Hook to fetch close orders, optionally filtered by position
 */
export function useCloseOrders(
  params?: UseCloseOrdersParams,
  options?: Omit<UseQueryOptions<SerializedCloseOrder[]>, 'queryKey' | 'queryFn'>
) {
  const { positionId, status, polling = false } = params ?? {};

  return useQuery({
    queryKey: positionId
      ? queryKeys.automation.closeOrders.byPosition(positionId)
      : queryKeys.automation.closeOrders.list({ positionId, status }),
    queryFn: async () => {
      const response = await automationApi.listCloseOrders({ positionId, status });
      return response.data;
    },
    staleTime: 30_000, // 30 seconds
    refetchInterval: polling ? 10_000 : false, // Poll every 10s if enabled
    ...options,
  });
}

/**
 * Hook to fetch a single close order by ID
 */
export function useCloseOrder(
  orderId: string | undefined,
  options?: Omit<UseQueryOptions<SerializedCloseOrder>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: queryKeys.automation.closeOrders.detail(orderId ?? ''),
    queryFn: async () => {
      if (!orderId) throw new Error('Order ID required');
      const response = await automationApi.getCloseOrder(orderId);
      return response.data;
    },
    enabled: !!orderId,
    staleTime: 30_000,
    ...options,
  });
}
