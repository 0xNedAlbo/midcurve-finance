import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { apiClientFn } from "@/lib/api-client";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";

interface RefreshPositionParams {
  chainId: number;
  nftId: string;
}

/**
 * Hook to refresh a Uniswap V3 position's on-chain data
 *
 * Calls POST /api/v1/positions/uniswapv3/:chainId/:nftId/refresh to fetch
 * fresh data from the blockchain and update the position in the database.
 *
 * @example
 * ```tsx
 * const refresh = useUniswapV3RefreshPosition();
 *
 * refresh.mutate({ chainId: 1, nftId: '123456' });
 * ```
 */
export function useUniswapV3RefreshPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chainId, nftId }: RefreshPositionParams) => {
      const endpoint = `/api/v1/positions/uniswapv3/${chainId}/${nftId}/refresh`;
      return await apiClientFn<GetUniswapV3PositionResponse>(endpoint, { method: "POST" });
    },
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(
        queryKeys.positions.uniswapv3.detail(variables.chainId, variables.nftId),
        data
      );
    },
  });
}
