/**
 * useCancelCloseOrder - Cancel a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the cancelClose transaction
 * directly with their connected wallet. After confirmation, it notifies
 * the API to update the order status.
 *
 * Flow:
 * 1. User calls cancelOrder()
 * 2. User signs cancelClose() tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation
 * 4. Notify API: POST /api/v1/automation/close-orders/[id]/cancelled
 * 5. Invalidate cache and return success
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { POSITION_CLOSER_ABI } from '@/config/contracts/uniswapv3-position-closer';
import type { SerializedCloseOrder } from '@midcurve/api-shared';

/**
 * Parameters for cancelling a close order
 */
export interface CancelCloseOrderParams {
  /** The automation contract address */
  contractAddress: Address;
  /** Chain ID */
  chainId: number;
  /** On-chain close order ID */
  closeId: bigint;
  /** Database order ID for API notification */
  orderId: string;
  /** Position ID for cache invalidation */
  positionId: string;
}

/**
 * Result from cancelling a close order
 */
export interface CancelCloseOrderResult {
  /** Transaction hash */
  txHash: Hash;
  /** Updated order from API */
  order?: SerializedCloseOrder;
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
  /** The result data (txHash, order) */
  result: CancelCloseOrderResult | null;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
}

/**
 * Hook for cancelling a close order via user's wallet
 */
export function useCancelCloseOrder(): UseCancelCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CancelCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<CancelCloseOrderParams | null>(null);

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

  // Handle transaction success - notify API
  useEffect(() => {
    if (!isTxSuccess || !txHash || !currentParams) return;

    const handleSuccess = async () => {
      try {
        // Notify API about the cancellation
        try {
          const response = await automationApi.notifyOrderCancelled(currentParams.orderId, {
            txHash,
          });

          setResult({
            txHash,
            order: response.data,
          });
        } catch (apiError) {
          // Even if API notification fails, the on-chain tx succeeded
          console.error('Failed to notify API of order cancellation:', apiError);
          setResult({
            txHash,
          });
        }

        // Invalidate caches
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.byPosition(currentParams.positionId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.lists(),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.detail(currentParams.orderId),
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };

    handleSuccess();
  }, [isTxSuccess, txHash, currentParams, queryClient]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Cancel function
  const cancelOrder = useCallback((params: CancelCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setCurrentParams(params);

    // Call writeContract with cancelClose function
    writeContract({
      address: params.contractAddress,
      abi: POSITION_CLOSER_ABI,
      functionName: 'cancelClose',
      args: [params.closeId],
      chainId: params.chainId,
    });
  }, [writeContract]);

  // Reset function
  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
    setCurrentParams(null);
  }, [resetWrite]);

  return {
    cancelOrder,
    isCancelling: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
  };
}
