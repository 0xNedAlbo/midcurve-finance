import {
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import {
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
} from "@/config/contracts/nonfungible-position-manager";

// Maximum uint128 value (collect all available fees)
const MAX_UINT128 = BigInt("0xffffffffffffffffffffffffffffffff");

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
  collectTxHash: Address | undefined;
  error: Error | null;
  reset: () => void;
}

/**
 * Hook for collecting fees from a Uniswap V3 position
 *
 * @param params - Collection parameters (can be null if wallet not connected or no fees)
 *
 * @example
 * const { collect, isCollecting, isSuccess } = useCollectFees({
 *   tokenId: 123456n,
 *   recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
 *   chainId: 1
 * });
 */
export function useCollectFees(
  params: CollectFeesParams | null
): UseCollectFeesResult {
  const {
    writeContract,
    data: collectTxHash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const txWatch = useWatchTransactionStatus({
    txHash: collectTxHash ?? null,
    chainId: params?.chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!collectTxHash,
  });
  const isWaitingForConfirmation = !!collectTxHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  const managerAddress = params
    ? NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[
        params.chainId as keyof typeof NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
      ]
    : undefined;

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
  };

  const error = writeError || receiptError;

  return {
    collect,
    isCollecting: isPending,
    isWaitingForConfirmation,
    isSuccess,
    collectTxHash,
    error,
    reset,
  };
}
