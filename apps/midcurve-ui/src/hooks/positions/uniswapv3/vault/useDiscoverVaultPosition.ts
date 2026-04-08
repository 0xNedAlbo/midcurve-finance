/**
 * useDiscoverVaultPosition - Import a newly created vault position into the backend
 *
 * Called after createVault() succeeds on-chain. Sends the vault address
 * to the backend, which reads vault state from the chain and creates
 * a position record in the database.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';

interface DiscoverVaultParams {
  chainId: number;
  vaultAddress: string;
  shareOwnerAddress: string;
}

interface DiscoverVaultResponse {
  positionId: string;
  positionHash: string;
}

export function useDiscoverVaultPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: DiscoverVaultParams) => {
      return apiClientFn<DiscoverVaultResponse>(
        '/api/v1/positions/uniswapv3-vault/discover',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.lists() });
    },
  });
}
