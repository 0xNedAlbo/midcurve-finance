/**
 * useUniswapV3VaultRefreshPosition - Manual refresh mutation for vault positions
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { apiClientFn } from "@/lib/api-client";
import type { GetUniswapV3VaultPositionResponse } from "@midcurve/api-shared";

interface RefreshVaultPositionParams {
  chainId: number;
  vaultAddress: string;
}

export function useUniswapV3VaultRefreshPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chainId, vaultAddress }: RefreshVaultPositionParams) => {
      return await apiClientFn<GetUniswapV3VaultPositionResponse>(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/refresh`,
        { method: "POST" }
      );
    },
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(
        queryKeys.positions.uniswapv3Vault.detail(variables.chainId, variables.vaultAddress),
        data
      );
    },
  });
}
