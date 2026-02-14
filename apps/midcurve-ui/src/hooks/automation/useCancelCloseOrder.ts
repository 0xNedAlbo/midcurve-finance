/**
 * useCancelCloseOrder - Cancel a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the cancelOrder transaction
 * directly with their connected wallet. After confirmation, it invalidates
 * caches so the UI picks up the cancellation made by the backend event subscriber.
 *
 * Flow:
 * 1. User calls cancelOrder()
 * 2. User signs cancelOrder() tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation
 * 4. Invalidate caches (backend event subscriber updates the DB record)
 *
 * V1.0 Interface (tick-based):
 * - Uses cancelOrder(nftId, orderType) instead of cancelClose(closeId)
 * - Orders identified by (nftId, orderType) - one SL and one TP per position
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { useSharedContract } from './useSharedContract';
import type { OrderType } from './useCreateCloseOrder';

/**
 * Parameters for cancelling a close order (V1.0 tick-based interface)
 * Note: ABI and contract address are fetched internally via useSharedContract
 */
export interface CancelCloseOrderParams {
  /** Order type: STOP_LOSS or TAKE_PROFIT */
  orderType: OrderType;
}

/**
 * Result from cancelling a close order
 */
export interface CancelCloseOrderResult {
  /** Transaction hash */
  txHash: Hash;
}

/**
 * Hook result
 */
export interface UseCancelCloseOrderResult {
  /** Cancel the close order */
  cancelOrder: (params: CancelCloseOrderParams) => void;
  /** Whether cancellation is in progress */
  isCancelling: boolean;
  /** Whether waiting for transaction confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether the cancellation was successful */
  isSuccess: boolean;
  /** The result data (txHash) */
  result: CancelCloseOrderResult | null;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
  /** Whether the shared contract is ready (ABI loaded) */
  isReady: boolean;
}

/**
 * Hook for cancelling a close order via user's wallet (V1.0 tick-based interface)
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The position NFT ID (as string)
 */
export function useCancelCloseOrder(
  chainId: number,
  nftId: string
): UseCancelCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CancelCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Fetch ABI and contract address from shared contract API
  const {
    data: sharedContract,
    isLoading: isLoadingContract,
  } = useSharedContract(chainId, nftId);

  const { abi, contractAddress } = sharedContract ?? {};
  const isReady = !isLoadingContract && !!abi && !!contractAddress;

  // Wagmi write contract hook
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess: isTxSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle transaction success — invalidate caches so UI picks up
  // the cancellation made by the backend event subscriber.
  useEffect(() => {
    if (!isTxSuccess || !txHash || result) return;

    setResult({ txHash });

    // Invalidate caches — backend event subscriber will have cancelled the order
    queryClient.invalidateQueries({
      queryKey: queryKeys.positions.uniswapv3.closeOrders.all(chainId, nftId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.positions.uniswapv3.detail(chainId, nftId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.automation.closeOrders.lists(),
    });
  }, [isTxSuccess, txHash, result, queryClient, chainId, nftId]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Cancel function - calls cancelOrder on shared contract (V1.0 interface)
  const cancelOrder = useCallback((params: CancelCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);

    // Pre-flight check: verify shared contract is ready
    if (!isReady || !abi || !contractAddress) {
      setError(new Error('Shared contract not ready. Please wait and try again.'));
      return;
    }

    // Map OrderType to contract enum value
    // Contract: STOP_LOSS = 0, TAKE_PROFIT = 1
    const orderTypeMap: Record<OrderType, number> = {
      'STOP_LOSS': 0,
      'TAKE_PROFIT': 1,
    };
    const orderTypeValue = orderTypeMap[params.orderType];

    // Call writeContract with cancelOrder function (V1.0 interface)
    writeContract({
      address: contractAddress as Address,
      abi,
      functionName: 'cancelOrder',
      args: [BigInt(nftId), orderTypeValue],
      chainId,
    });
  }, [writeContract, isReady, abi, contractAddress, chainId, nftId]);

  // Reset function
  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
  }, [resetWrite]);

  return {
    cancelOrder,
    isCancelling: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
    isReady,
  };
}
