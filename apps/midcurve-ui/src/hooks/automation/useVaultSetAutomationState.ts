/**
 * useVaultSetAutomationState - Set vault close order monitoring state via API
 *
 * Vault-specific: uses vault API path instead of NFT path.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { SerializedCloseOrder } from '@midcurve/api-shared';

interface VaultSetAutomationStateParams {
  chainId: number;
  vaultAddress: string;
  closeOrderHash: string;
  automationState: 'monitoring' | 'paused';
}

export function useVaultSetAutomationState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: VaultSetAutomationStateParams) => {
      return apiClient.patch<SerializedCloseOrder>(
        `/api/v1/positions/uniswapv3-vault/${params.chainId}/${params.vaultAddress}/close-orders/${params.closeOrderHash}/automation-state`,
        { automationState: params.automationState }
      );
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3Vault.detail(params.chainId, params.vaultAddress),
      });
    },
  });
}

export type { VaultSetAutomationStateParams };
