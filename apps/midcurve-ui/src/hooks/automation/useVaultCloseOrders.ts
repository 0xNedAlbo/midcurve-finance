/**
 * useVaultCloseOrders - Fetch close orders for a vault position
 *
 * Fetches close orders for a specific vault position using the
 * vault position-scoped API endpoints.
 *
 * Polling behavior:
 * - When polling=true: polls every 10s normally
 * - When any order is executing/retrying: polls every 2s for faster UI updates
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import type { SerializedCloseOrder, AutomationState } from '@midcurve/api-shared';

/** Normal polling interval (10 seconds) */
const POLLING_INTERVAL_NORMAL = 10_000;

/** Fast polling interval when orders are executing (2 seconds) */
const POLLING_INTERVAL_EXECUTING = 2_000;

interface UseVaultCloseOrdersParams {
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
  automationState?: AutomationState;
  type?: 'sl' | 'tp';
  polling?: boolean;
}

/**
 * Check if any order is currently executing or retrying
 */
function hasExecutingOrder(orders: SerializedCloseOrder[] | undefined): boolean {
  return orders?.some((order) =>
    order.automationState === 'executing' || order.automationState === 'retrying'
  ) ?? false;
}

/**
 * Hook to fetch close orders for a specific vault position
 *
 * Uses the vault position-scoped API: GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/close-orders
 */
export function useVaultCloseOrders(
  params: UseVaultCloseOrdersParams,
  options?: Omit<UseQueryOptions<SerializedCloseOrder[]>, 'queryKey' | 'queryFn'>
) {
  const { chainId, vaultAddress, ownerAddress, automationState, type, polling = false } = params;

  return useQuery({
    queryKey: queryKeys.positions.uniswapv3Vault.closeOrders.list(chainId, vaultAddress, ownerAddress, { automationState, type }),
    queryFn: async () => {
      const response = await automationApi.vaultPositionCloseOrders.list(chainId, vaultAddress, ownerAddress, { automationState, type });
      return response.data;
    },
    staleTime: 30_000,
    refetchInterval: polling
      ? (query) =>
          hasExecutingOrder(query.state.data)
            ? POLLING_INTERVAL_EXECUTING
            : POLLING_INTERVAL_NORMAL
      : false,
    ...options,
  });
}
