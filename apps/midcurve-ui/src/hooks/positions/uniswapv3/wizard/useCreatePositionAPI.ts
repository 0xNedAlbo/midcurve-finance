import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EvmChainSlug } from "@/config/chains";
import { getChainId } from "@/config/chains";
import { apiClient } from "@/lib/api-client";

/**
 * Data required to create a position via API after successful mint
 */
export interface CreatePositionData {
    chainId: EvmChainSlug;
    nftId: string;
    /** Address of the quote token as selected by the user in the wizard */
    quoteTokenAddress: string;
}

/**
 * Result type for useCreatePositionAPI hook
 */
export type UseCreatePositionAPIResult = ReturnType<typeof useCreatePositionAPI>;

/**
 * Hook to create a position in the database via API after successful on-chain mint.
 *
 * Calls PUT /api/v1/positions/uniswapv3/:chainId/:nftId which internally calls
 * discover() to read real on-chain state and import full ledger history.
 *
 * Automatically invalidates the positions list query to trigger a refetch.
 */
export function useCreatePositionAPI() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: CreatePositionData) => {
            const numericChainId = getChainId(data.chainId);

            const response = await apiClient.put(
                `/api/v1/positions/uniswapv3/${numericChainId}/${data.nftId}`,
                {
                    quoteTokenAddress: data.quoteTokenAddress,
                }
            );

            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["positions", "list"] });
        },
    });
}
