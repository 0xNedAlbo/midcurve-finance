/**
 * useCreateCloseOrder - Register a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the registerClose transaction
 * directly with their connected wallet. After confirmation, it notifies
 * the API to start monitoring the order.
 *
 * Flow:
 * 1. User calls registerOrder()
 * 2. User signs registerClose() tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation
 * 4. Parse CloseRegistered event for closeId
 * 5. Notify API: POST /api/v1/automation/close-orders/notify
 * 6. Return the created order
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { decodeEventLog, type Address, type Hash, type TransactionReceipt } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { POSITION_CLOSER_ABI } from '@/config/contracts/uniswapv3-position-closer';
import type { SerializedCloseOrder } from '@midcurve/api-shared';

/**
 * Parameters for registering a close order
 */
export interface RegisterCloseOrderParams {
  /** The automation contract address on this chain */
  contractAddress: Address;
  /** Chain ID */
  chainId: number;
  /** NFT token ID of the position */
  nftId: bigint;
  /** Lower price trigger (sqrtPriceX96) */
  sqrtPriceX96Lower: bigint;
  /** Upper price trigger (sqrtPriceX96) */
  sqrtPriceX96Upper: bigint;
  /** Address to receive funds after close */
  payoutAddress: Address;
  /** Unix timestamp when order expires */
  validUntil: bigint;
  /** Slippage tolerance in basis points (e.g., 100 = 1%) */
  slippageBps: number;
  /** Position ID for API notification and cache invalidation */
  positionId: string;
  /** Pool address for API notification */
  poolAddress: Address;
}

/**
 * Result from creating a close order
 */
export interface CreateCloseOrderResult {
  /** The on-chain close order ID */
  closeId: bigint;
  /** Transaction hash */
  txHash: Hash;
  /** The created order (after API notification) */
  order?: SerializedCloseOrder;
}

/**
 * Hook result
 */
export interface UseCreateCloseOrderResult {
  /** Register a new close order */
  registerOrder: (params: RegisterCloseOrderParams) => void;
  /** Whether a registration is in progress */
  isRegistering: boolean;
  /** Whether waiting for transaction confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether the registration was successful */
  isSuccess: boolean;
  /** The result data (closeId, txHash, order) */
  result: CreateCloseOrderResult | null;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
}

/**
 * Parse CloseRegistered event from transaction receipt
 */
function parseCloseRegisteredEvent(
  receipt: TransactionReceipt,
  contractAddress: Address
): bigint | null {
  try {
    // Find the CloseRegistered event
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: POSITION_CLOSER_ABI,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === 'CloseRegistered') {
          // The closeId is the first indexed parameter
          return (decoded.args as { closeId: bigint }).closeId;
        }
      } catch {
        // Not this event, continue
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to parse CloseRegistered event:', error);
    return null;
  }
}

/**
 * Hook for creating a close order via user's wallet
 */
export function useCreateCloseOrder(): UseCreateCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CreateCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<RegisterCloseOrderParams | null>(null);

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
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle transaction success - parse event and notify API
  useEffect(() => {
    if (!isTxSuccess || !receipt || !txHash || !currentParams) return;

    const handleSuccess = async () => {
      try {
        // Parse closeId from event
        const closeId = parseCloseRegisteredEvent(receipt, currentParams.contractAddress);

        if (closeId === null) {
          throw new Error('Failed to parse CloseRegistered event from transaction');
        }

        // Notify API about the new order
        try {
          const response = await automationApi.notifyOrderRegistered({
            chainId: currentParams.chainId,
            contractAddress: currentParams.contractAddress,
            closeId: closeId.toString(),
            nftId: currentParams.nftId.toString(),
            positionId: currentParams.positionId,
            poolAddress: currentParams.poolAddress,
            txHash,
          });

          setResult({
            closeId,
            txHash,
            order: response.data,
          });
        } catch (apiError) {
          // Even if API notification fails, the on-chain tx succeeded
          console.error('Failed to notify API of close order:', apiError);
          setResult({
            closeId,
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
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };

    handleSuccess();
  }, [isTxSuccess, receipt, txHash, currentParams, queryClient]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Register function
  const registerOrder = useCallback((params: RegisterCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setCurrentParams(params);

    // Call writeContract with registerClose function
    writeContract({
      address: params.contractAddress,
      abi: POSITION_CLOSER_ABI,
      functionName: 'registerClose',
      args: [
        params.nftId,
        params.sqrtPriceX96Lower,
        params.sqrtPriceX96Upper,
        params.payoutAddress,
        params.validUntil,
        params.slippageBps,
      ],
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
    registerOrder,
    isRegistering: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
  };
}

export type { SerializedCloseOrder };
