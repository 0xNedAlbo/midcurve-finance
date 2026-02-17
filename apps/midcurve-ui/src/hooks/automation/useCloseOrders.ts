/**
 * useCloseOrders - Fetch close orders for a position
 *
 * Fetches close orders for a specific Uniswap V3 position using the
 * position-scoped API endpoints.
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

/**
 * Parameters for position-scoped close orders query
 */
interface UseCloseOrdersParams {
  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Uniswap V3 NFT token ID
   */
  nftId: string;

  /**
   * Filter by status
   */
  status?: CloseOrderStatus;

  /**
   * Filter by order type (sl = stop-loss, tp = take-profit)
   */
  type?: 'sl' | 'tp';

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
 * Hook to fetch close orders for a specific position
 *
 * Uses the position-scoped API: GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders
 */
export function useCloseOrders(
  params: UseCloseOrdersParams,
  options?: Omit<UseQueryOptions<SerializedCloseOrder[]>, 'queryKey' | 'queryFn'>
) {
  const { chainId, nftId, status, type, polling = false } = params;

  return useQuery({
    queryKey: queryKeys.positions.uniswapv3.closeOrders.list(chainId, nftId, { status, type }),
    queryFn: async () => {
      const response = await automationApi.positionCloseOrders.list(chainId, nftId, { status, type });
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
 * Parameters for single close order query by semantic hash
 */
interface UseCloseOrderByHashParams {
  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Uniswap V3 NFT token ID
   */
  nftId: string;

  /**
   * Close order semantic hash (e.g., "sl@-12345", "tp@201120")
   */
  closeOrderHash: string;
}

/**
 * Hook to fetch a single close order by semantic hash
 *
 * Uses the position-scoped API: GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 */
export function useCloseOrderByHash(
  params: UseCloseOrderByHashParams | undefined,
  options?: Omit<UseQueryOptions<SerializedCloseOrder>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  const enabled = !!params?.chainId && !!params?.nftId && !!params?.closeOrderHash;

  return useQuery({
    queryKey: params
      ? queryKeys.positions.uniswapv3.closeOrders.detail(params.chainId, params.nftId, params.closeOrderHash)
      : ['close-order', 'none'],
    queryFn: async () => {
      if (!params) throw new Error('Close order params required');
      const response = await automationApi.positionCloseOrders.get(
        params.chainId,
        params.nftId,
        params.closeOrderHash
      );
      return response.data;
    },
    enabled,
    staleTime: 30_000,
    ...options,
  });
}

