import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { apiClient } from "@/lib/api-client";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";

interface RefreshPositionParams {
  protocol: string;
  chainId: number;
  nftId: string;
}

/**
 * Hook to refresh a position's on-chain data
 *
 * Calls the appropriate protocol-specific endpoint to fetch fresh data
 * from the blockchain and updates the position in the database.
 *
 * @example
 * ```tsx
 * const refresh = useRefreshPosition();
 *
 * refresh.mutate({
 *   protocol: 'uniswapv3',
 *   chainId: 1,
 *   nftId: '123456'
 * });
 * ```
 */
export function useRefreshPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: RefreshPositionParams) => {
      const { protocol, chainId, nftId } = params;

      // Route to appropriate endpoint based on protocol
      let endpoint: string;
      switch (protocol) {
        case "uniswapv3":
          endpoint = `/api/v1/positions/uniswapv3/${chainId}/${nftId}`;
          break;
        // Future protocols can be added here
        // case "orca":
        //   endpoint = `/api/v1/positions/orca/${nftId}`;
        //   break;
        default:
          throw new Error(`Unsupported protocol: ${protocol}`);
      }

      // Use apiClient to handle response structure correctly
      return await apiClient<GetUniswapV3PositionResponse>(endpoint);
    },
    onSuccess: async (data, variables) => {
      // Invalidate the positions list to ensure UI consistency
      await queryClient.invalidateQueries({
        queryKey: queryKeys.positions.lists(),
      });

      // Also update the individual position cache if it exists
      if (variables.protocol === "uniswapv3") {
        queryClient.setQueryData(
          queryKeys.positions.uniswapv3.detail(
            variables.chainId,
            variables.nftId
          ),
          data
        );
      }
    },
  });
}
