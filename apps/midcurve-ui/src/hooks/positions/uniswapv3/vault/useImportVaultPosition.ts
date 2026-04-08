/**
 * useImportVaultPosition - Import a vault position by contract address
 *
 * Used from the "Import Tokenized Position by Address" dropdown option.
 * Calls the vault discover endpoint which reads vault state from the chain
 * and creates a position record in the database.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';

interface ImportVaultPositionParams {
  chainId: number;
  vaultAddress: string;
  shareOwnerAddress: string;
}

interface ImportVaultPositionResponse {
  positionId: string;
  positionHash: string;
}

export function useImportVaultPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ImportVaultPositionParams) => {
      return apiClientFn<ImportVaultPositionResponse>(
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
