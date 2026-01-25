/**
 * useCancelCloseOrder - Cancel a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the cancelClose transaction
 * directly with their connected wallet. After confirmation, it updates
 * the order status in the database.
 *
 * Flow:
 * 1. User calls cancelOrder()
 * 2. User signs cancelClose() tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation (with 60s timeout)
 * 4. On success/failure/timeout: Cancel via DELETE /api/v1/automation/close-orders/[id]
 * 5. Invalidate cache and return success
 */

/** Timeout for waiting on transaction confirmation (60 seconds) */
const TX_TIMEOUT_MS = 60_000;

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
  /** Uniswap V3 NFT token ID (for position-scoped API) */
  nftId: string;
  /** Close order semantic hash (e.g., "sl@-12345", "tp@201120") */
  closeOrderHash: string;
  /**
   * Database order ID for API notification
   * @deprecated Use closeOrderHash with position-scoped endpoints instead
   */
  orderId?: string;
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
}

/**
 * Hook for cancelling a close order via user's wallet
 */
export function useCancelCloseOrder(): UseCancelCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CancelCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<CancelCloseOrderParams | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [forceCancelled, setForceCancelled] = useState(false);

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
        params.chainId,
        params.nftId,
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
        queryKey: queryKeys.positions.uniswapv3.closeOrders.all(params.chainId, params.nftId),
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
  }, [txHash, queryClient]);

  // Handle transaction success - update order status in database
  useEffect(() => {
    if (!isTxSuccess || !txHash || !currentParams || forceCancelled) return;

    const handleSuccess = async () => {
      try {
        // Cancel the order in the database via position-scoped DELETE endpoint
        const response = await automationApi.positionCloseOrders.cancel(
          currentParams.chainId,
          currentParams.nftId,
          currentParams.closeOrderHash
        );

        setResult({
          txHash,
          order: response.data,
        });

        // Invalidate position-scoped caches
        queryClient.invalidateQueries({
          queryKey: queryKeys.positions.uniswapv3.closeOrders.all(currentParams.chainId, currentParams.nftId),
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
  }, [isTxSuccess, txHash, currentParams, queryClient, forceCancelled]);

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

  // Cancel function
  const cancelOrder = useCallback((params: CancelCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setIsTimedOut(false);
    setForceCancelled(false);
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
  };
}
