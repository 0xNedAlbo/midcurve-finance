/**
 * useRegisterVault - Register deployed vault with backend
 *
 * After deploying the vault contract on-chain, this hook registers
 * it with the backend so the strategy knows about the vault.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, apiClientFn } from '@/lib/api-client';
import type { RegisterVaultData, RegisterVaultRequest } from '@midcurve/api-shared';

export interface RegisterVaultParams {
  /** Strategy contract address (for API route) */
  strategyAddress: string;
  /** Request body */
  request: RegisterVaultRequest;
}

export function useRegisterVault() {
  const queryClient = useQueryClient();

  return useMutation<RegisterVaultData, ApiError, RegisterVaultParams>({
    mutationFn: async ({ strategyAddress, request }) => {
      return apiClientFn<RegisterVaultData>(
        `/api/strategy/${strategyAddress}/vault`,
        {
          method: 'POST',
          body: JSON.stringify(request),
        }
      );
    },
    onSuccess: (_data, variables) => {
      // Invalidate strategy queries to refresh vault status
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });

      // Invalidate specific strategy detail
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.byAddress(variables.strategyAddress),
      });
    },
  });
}
