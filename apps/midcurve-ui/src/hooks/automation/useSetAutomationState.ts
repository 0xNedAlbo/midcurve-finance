/**
 * useSetAutomationState - Set close order monitoring state via API
 *
 * User-initiated monitoring control: pause or resume monitoring.
 * This is an API-only operation — no on-chain transaction needed.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface SetAutomationStateParams {
  chainId: number;
  nftId: string;
  closeOrderHash: string;
  automationState: 'monitoring' | 'paused';
}

export function useSetAutomationState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SetAutomationStateParams) => {
      const response = await automationApi.positionCloseOrders.setAutomationState(
        params.chainId,
        params.nftId,
        params.closeOrderHash,
        params.automationState
      );
      return response;
    },
    onSuccess: (_data, params) => {
      // Invalidate close orders list so UI refreshes
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.closeOrders.all(params.chainId, params.nftId),
      });
    },
  });
}

export type { SetAutomationStateParams };
