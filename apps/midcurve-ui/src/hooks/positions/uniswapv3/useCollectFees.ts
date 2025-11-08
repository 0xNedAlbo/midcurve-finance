import { useEffect, useState } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import type { Address, TransactionReceipt } from "viem";
import {
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
} from "@/config/contracts/nonfungible-position-manager";

// Maximum uint128 value (collect all available fees)
const MAX_UINT128 = BigInt("0xffffffffffffffffffffffffffffffff");

// Collect event signature
const COLLECT_EVENT_TOPIC =
  "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01";

export interface CollectFeesParams {
  tokenId: bigint;
  recipient: Address;
  chainId: number;
}

export interface UseCollectFeesResult {
  collect: () => void;
  isCollecting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  receipt: TransactionReceipt | undefined;
  collectedAmount0: bigint | undefined;
  collectedAmount1: bigint | undefined;
  collectLogIndex: number | undefined;
  error: Error | null;
  reset: () => void;
}

/**
 * Hook for collecting fees from a Uniswap V3 position
 *
 * @param params - Collection parameters (can be null if wallet not connected or no fees)
 *
 * @example
 * const { collect, isCollecting, isSuccess, collectedAmount0, collectedAmount1 } = useCollectFees({
 *   tokenId: 123456n,
 *   recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
 *   chainId: 1
 * });
 */
export function useCollectFees(
  params: CollectFeesParams | null
): UseCollectFeesResult {
  const [collectedAmount0, setCollectedAmount0] = useState<bigint | undefined>(
    undefined
  );
  const [collectedAmount1, setCollectedAmount1] = useState<bigint | undefined>(
    undefined
  );
  const [collectLogIndex, setCollectLogIndex] = useState<number | undefined>(
    undefined
  );

  const {
    writeContract,
    data: collectTxHash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isWaitingForConfirmation,
    isSuccess,
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: collectTxHash,
  });

  const managerAddress = params
    ? NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[
        params.chainId as keyof typeof NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
      ]
    : undefined;

  // Parse collected amounts from transaction receipt
  useEffect(() => {
    if (!isSuccess || !receipt || !managerAddress) return;

    try {
      // Find the Collect event log
      const collectLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === managerAddress.toLowerCase() &&
          log.topics[0] === COLLECT_EVENT_TOPIC
      );

      if (collectLog && collectLog.data) {
        // Extract amounts from event data
        // Event data format: amount0 (32 bytes) + amount1 (32 bytes)
        const amount0Hex = "0x" + collectLog.data.slice(2, 66);
        const amount1Hex = "0x" + collectLog.data.slice(66, 130);

        setCollectedAmount0(BigInt(amount0Hex));
        setCollectedAmount1(BigInt(amount1Hex));
        setCollectLogIndex(Number(collectLog.logIndex));
      }
    } catch (error) {
      console.error("Failed to parse Collect event:", error);
    }
  }, [isSuccess, receipt, managerAddress]);

  const collect = () => {
    if (!params) {
      console.error("Cannot collect fees: params is null (wallet not connected or no fees)");
      return;
    }

    if (!managerAddress) {
      console.error(
        `NonfungiblePositionManager address not found for chain ${params.chainId}`
      );
      return;
    }

    writeContract({
      address: managerAddress,
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
      functionName: "collect",
      args: [
        {
          tokenId: params.tokenId,
          recipient: params.recipient,
          amount0Max: MAX_UINT128, // Collect all available fees
          amount1Max: MAX_UINT128,
        },
      ],
      chainId: params.chainId,
    });
  };

  const reset = () => {
    resetWrite();
    setCollectedAmount0(undefined);
    setCollectedAmount1(undefined);
    setCollectLogIndex(undefined);
  };

  const error = writeError || receiptError;

  return {
    collect,
    isCollecting: isPending,
    isWaitingForConfirmation,
    isSuccess,
    receipt,
    collectedAmount0,
    collectedAmount1,
    collectLogIndex,
    error,
    reset,
  };
}
