import { useMutation, useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, type Address, type TransactionReceipt } from "viem";
import type { EvmChainSlug } from "@/config/chains";
import { getChainId } from "@/config/chains";

// IncreaseLiquidity event ABI from Uniswap V3 NonfungiblePositionManager
const INCREASE_LIQUIDITY_EVENT_ABI = {
    anonymous: false,
    inputs: [
        { indexed: true, name: "tokenId", type: "uint256" },
        { indexed: false, name: "liquidity", type: "uint128" },
        { indexed: false, name: "amount0", type: "uint256" },
        { indexed: false, name: "amount1", type: "uint256" },
    ],
    name: "IncreaseLiquidity",
    type: "event",
} as const;

/**
 * Data required to create a position via API after successful mint
 */
export interface CreatePositionData {
    chainId: EvmChainSlug;
    nftId: string;
    poolAddress: Address;
    tickLower: number;
    tickUpper: number;
    ownerAddress: Address;
    quoteTokenAddress: Address;
    receipt: TransactionReceipt;
}

/**
 * Extract INCREASE_LIQUIDITY event data from mint transaction receipt
 */
async function extractIncreaseEventFromReceipt(receipt: TransactionReceipt) {
    // Find the IncreaseLiquidity event
    // Event signature: 0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f
    const increaseLiquidityLog = receipt.logs.find(
        (log) =>
            log.topics[0] ===
            "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f"
    );

    if (!increaseLiquidityLog) {
        throw new Error(
            "IncreaseLiquidity event not found in transaction receipt"
        );
    }

    // Decode the event data using viem
    const decodedEvent = decodeEventLog({
        abi: [INCREASE_LIQUIDITY_EVENT_ABI],
        data: increaseLiquidityLog.data,
        topics: increaseLiquidityLog.topics,
    });

    // Extract the actual values from the decoded event
    const { liquidity, amount0, amount1 } = decodedEvent.args;

    // Use current timestamp as approximation
    // The backend will fetch the accurate block timestamp from the blockchain
    const timestamp = new Date().toISOString();

    // Validate that we have real values
    if (liquidity === 0n) {
        console.warn("Warning: IncreaseLiquidity event has zero liquidity");
    }

    return {
        timestamp,
        blockNumber: receipt.blockNumber.toString(),
        transactionIndex: receipt.transactionIndex,
        logIndex: increaseLiquidityLog.logIndex || 0,
        transactionHash: receipt.transactionHash,
        liquidity: liquidity.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
    };
}

/**
 * Hook to create a position in the database via API after successful on-chain mint
 *
 * Automatically invalidates the positions list query to trigger a refetch.
 */
export function useCreatePositionAPI() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: CreatePositionData) => {
            const increaseEvent = await extractIncreaseEventFromReceipt(
                data.receipt
            );

            // Convert chain slug to numeric chain ID for API
            const numericChainId = getChainId(data.chainId);

            const response = await fetch(
                `/api/v1/positions/uniswapv3/${numericChainId}/${data.nftId}`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        poolAddress: data.poolAddress,
                        tickUpper: data.tickUpper,
                        tickLower: data.tickLower,
                        ownerAddress: data.ownerAddress,
                        quoteTokenAddress: data.quoteTokenAddress,
                        increaseEvent,
                    }),
                }
            );

            if (!response.ok) {
                const error = await response.json().catch(() => ({
                    error: "Failed to create position in database",
                }));
                throw new Error(error.error || "Failed to create position");
            }

            return response.json();
        },
        onSuccess: () => {
            // Invalidate positions list to trigger refetch
            queryClient.invalidateQueries({ queryKey: ["positions", "list"] });
        },
    });
}
