/**
 * useCancelCloseOrder - Cancel a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the cancelOrder transaction
 * directly with their connected wallet. After confirmation, it updates
 * the order status in the database.
 *
 * Flow:
 * 1. User calls cancelOrder()
 * 2. User signs cancelOrder() tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation (with 60s timeout)
 * 4. On success/failure/timeout: Cancel via DELETE /api/v1/automation/close-orders/[id]
 * 5. Invalidate cache and return success
 *
 * V1.0 Interface (tick-based):
 * - Uses cancelOrder(nftId, orderType) instead of cancelClose(closeId)
 * - Orders identified by (nftId, orderType) - one SL and one TP per position
 */

/** Timeout for waiting on transaction confirmation (60 seconds) */
const TX_TIMEOUT_MS = 60_000;

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { useSharedContract } from './useSharedContract';
import type { SerializedCloseOrder } from '@midcurve/api-shared';
import type { OrderType } from './useCreateCloseOrder';

/**
 * Parameters for cancelling a close order (V1.0 tick-based interface)
 * Note: ABI and contract address are fetched internally via useSharedContract
 */
export interface CancelCloseOrderParams {
  /** Order type: STOP_LOSS or TAKE_PROFIT */
  orderType: OrderType;
  /** Close order semantic hash for API (e.g., "sl@-12345", "tp@201120") */
  closeOrderHash: string;
  /**
   * Position ID for cache invalidation
   * @deprecated Derived from chainId/nftId for position-scoped endpoints
   */
  positionId?: string;
}

/**
 * Result from cancelling a close order
 */
export interface CancelCloseOrderResult {
  /** Transaction hash (may be undefined if force-cancelled before tx was submitted) */
  txHash?: Hash;
  /** Updated order from API */
  order?: SerializedCloseOrder;
  /** True if cancelled in DB without on-chain confirmation (due to timeout or tx failure) */
  forceCancelled?: boolean;
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
  /** Whether the transaction timed out */
  isTimedOut: boolean;
  /** Whether the order was force-cancelled in DB (due to timeout or tx failure) */
  forceCancelled: boolean;
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
  const [currentParams, setCurrentParams] = useState<CancelCloseOrderParams | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [forceCancelled, setForceCancelled] = useState(false);

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

  // Force cancel the order in the database (DELETE endpoint)
  const forceCancel = useCallback(async (params: CancelCloseOrderParams) => {
    try {
      // Use position-scoped endpoint
      const response = await automationApi.positionCloseOrders.cancel(
        chainId,
        nftId,
        params.closeOrderHash
      );
      setForceCancelled(true);
      setResult({
        txHash,
        order: response.data,
        forceCancelled: true,
      });

      // Invalidate position-scoped caches
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.closeOrders.all(chainId, nftId),
      });
      // Also invalidate legacy caches for backward compatibility
      if (params.positionId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.byPosition(params.positionId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.closeOrders.lists(),
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to force cancel order'));
    }
  }, [txHash, queryClient, chainId, nftId]);

  // Handle transaction success - update order status in database
  useEffect(() => {
    if (!isTxSuccess || !txHash || !currentParams || forceCancelled) return;

    const handleSuccess = async () => {
      try {
        // Cancel the order in the database via position-scoped DELETE endpoint
        const response = await automationApi.positionCloseOrders.cancel(
          chainId,
          nftId,
          currentParams.closeOrderHash
        );

        setResult({
          txHash,
          order: response.data,
        });

        // Invalidate position-scoped caches
        queryClient.invalidateQueries({
          queryKey: queryKeys.positions.uniswapv3.closeOrders.all(chainId, nftId),
        });
        // Also invalidate legacy caches for backward compatibility
        if (currentParams.positionId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.automation.closeOrders.byPosition(currentParams.positionId),
          });
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.lists(),
        });
      } catch (err) {
        // Even if DB update fails, the on-chain tx succeeded
        console.error('Failed to update order status in database:', err);
        setResult({
          txHash,
        });
      }
    };

    handleSuccess();
  }, [isTxSuccess, txHash, currentParams, queryClient, forceCancelled, chainId, nftId]);

  // Timeout mechanism - force cancel if tx takes too long
  useEffect(() => {
    // Only start timeout after tx is submitted (we have txHash) and still waiting
    if (!txHash || isTxSuccess || forceCancelled || !currentParams) return;

    const timeout = setTimeout(() => {
      console.warn('Transaction timeout reached, force cancelling order in database');
      setIsTimedOut(true);
      forceCancel(currentParams);
    }, TX_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [txHash, isTxSuccess, forceCancelled, currentParams, forceCancel]);

  // Handle errors - force cancel on tx failure
  useEffect(() => {
    const err = writeError || receiptError;
    if (err && currentParams && !forceCancelled) {
      console.error('Transaction failed, force cancelling order in database:', err);
      setError(err);
      forceCancel(currentParams);
    }
  }, [writeError, receiptError, currentParams, forceCancelled, forceCancel]);

  // Cancel function - calls cancelOrder on shared contract (V1.0 interface)
  const cancelOrder = useCallback((params: CancelCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setIsTimedOut(false);
    setForceCancelled(false);
    setCurrentParams(params);

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
    setCurrentParams(null);
    setIsTimedOut(false);
    setForceCancelled(false);
  }, [resetWrite]);

  return {
    cancelOrder,
    isCancelling: isWritePending,
    isWaitingForConfirmation,
    isSuccess: (isTxSuccess || forceCancelled) && result !== null,
    result,
    error,
    isTimedOut,
    forceCancelled,
    reset,
    isReady,
  };
}
