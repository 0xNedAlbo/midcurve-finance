/**
 * useCloseOrders - Fetch close orders for a position
 *
 * Fetches close orders optionally filtered by position ID.
 * Supports polling for orders in pending/active states.
 *
 * Polling behavior:
 * - When polling=true: polls every 10s normally
 * - When any order is in 'triggering' state: polls every 2s for faster UI updates
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import type { SerializedCloseOrder, CloseOrderStatus } from '@midcurve/api-shared';

/** Normal polling interval (10 seconds) */
const POLLING_INTERVAL_NORMAL = 10_000;

/** Fast polling interval when orders are executing (2 seconds) */
const POLLING_INTERVAL_EXECUTING = 2_000;

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
 * Check if any order is currently executing (triggering status)
 */
function hasExecutingOrder(orders: SerializedCloseOrder[] | undefined): boolean {
  return orders?.some((order) => order.status === 'triggering') ?? false;
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
    // Dynamic polling: faster when orders are executing
    refetchInterval: polling
      ? (query) =>
          hasExecutingOrder(query.state.data)
            ? POLLING_INTERVAL_EXECUTING
            : POLLING_INTERVAL_NORMAL
      : false,
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
