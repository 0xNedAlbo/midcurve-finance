/**
 * useUpdateCloseOrder - Update close order parameters via user's wallet
 *
 * This hook uses Wagmi to have the user sign update transactions
 * directly with their connected wallet. After confirmation, it
 * invalidates the cache and returns success.
 *
 * V1.0 Interface (tick-based):
 * - setTriggerTick(nftId, orderType, newTriggerTick)
 * - setSlippage(nftId, orderType, newSlippageBps)
 * - setPayout(nftId, orderType, newPayout)
 * - setValidUntil(nftId, orderType, newValidUntil)
 * - setOperator(nftId, orderType, newOperator)
 * - setSwapIntent(nftId, orderType, direction, quoteToken, swapSlippageBps)
 *
 * Flow:
 * 1. User calls updateOrder() with the update type and params
 * 2. User signs the update tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation
 * 4. Invalidate cache and return success
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { useSharedContract } from './useSharedContract';
import type { OrderType } from './useCreateCloseOrder';

/**
 * Update type enum (V1.0 interface)
 */
export type UpdateType = 'triggerTick' | 'slippage' | 'payout' | 'validUntil' | 'operator' | 'swapIntent';

/**
 * Base parameters for all updates (V1.0 interface)
 * Note: ABI, contract address, chainId, nftId are fetched/passed to hook
 */
interface BaseUpdateParams {
  /** Order type: STOP_LOSS or TAKE_PROFIT */
  orderType: OrderType;
  /** Close order semantic hash for cache invalidation (e.g., "sl@-12345", "tp@201120") */
  closeOrderHash: string;
  /**
   * Position ID for cache invalidation
   * @deprecated Derived from chainId/nftId for position-scoped endpoints
   */
  positionId?: string;
}

/**
 * Parameters for updating trigger tick
 */
export interface UpdateTriggerTickParams extends BaseUpdateParams {
  updateType: 'triggerTick';
  triggerTick: number;
}

/**
 * Parameters for updating slippage
 */
export interface UpdateSlippageParams extends BaseUpdateParams {
  updateType: 'slippage';
  slippageBps: number;
}

/**
 * Parameters for updating payout address
 */
export interface UpdatePayoutParams extends BaseUpdateParams {
  updateType: 'payout';
  payoutAddress: Address;
}

/**
 * Parameters for updating valid until
 */
export interface UpdateValidUntilParams extends BaseUpdateParams {
  updateType: 'validUntil';
  validUntil: bigint;
}

/**
 * Parameters for updating operator
 */
export interface UpdateOperatorParams extends BaseUpdateParams {
  updateType: 'operator';
  operatorAddress: Address;
}

/**
 * Parameters for updating swap intent
 */
export interface UpdateSwapIntentParams extends BaseUpdateParams {
  updateType: 'swapIntent';
  direction: 'NONE' | 'TOKEN0_TO_1' | 'TOKEN1_TO_0';
  swapSlippageBps: number;
}

/**
 * Union type of all update params
 */
export type UpdateCloseOrderParams =
  | UpdateTriggerTickParams
  | UpdateSlippageParams
  | UpdatePayoutParams
  | UpdateValidUntilParams
  | UpdateOperatorParams
  | UpdateSwapIntentParams;

/**
 * Result from updating a close order
 */
export interface UpdateCloseOrderResult {
  /** Transaction hash */
  txHash: Hash;
  /** Update type that was performed */
  updateType: UpdateType;
}

/**
 * Hook result
 */
export interface UseUpdateCloseOrderResult {
  /** Update the close order */
  updateOrder: (params: UpdateCloseOrderParams) => void;
  /** Whether update is in progress */
  isUpdating: boolean;
  /** Whether waiting for transaction confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether the update was successful */
  isSuccess: boolean;
  /** The result data (txHash, updateType) */
  result: UpdateCloseOrderResult | null;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
  /** Whether the shared contract is ready (ABI loaded) */
  isReady: boolean;
}

/**
 * Hook for updating a close order via user's wallet (V1.0 tick-based interface)
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The position NFT ID (as string)
 */
export function useUpdateCloseOrder(
  chainId: number,
  nftId: string
): UseUpdateCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<UpdateCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<UpdateCloseOrderParams | null>(null);

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

  // Handle transaction success
  useEffect(() => {
    if (!isTxSuccess || !txHash || !currentParams) return;

    // Set result
    setResult({
      txHash,
      updateType: currentParams.updateType,
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
  }, [isTxSuccess, txHash, currentParams, queryClient, chainId, nftId]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Update function - calls update functions on shared contract (V1.0 interface)
  const updateOrder = useCallback((params: UpdateCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setCurrentParams(params);

    // Pre-flight check: verify shared contract is ready
    if (!isReady || !abi || !contractAddress) {
      setError(new Error('Shared contract not ready. Please wait and try again.'));
      return;
    }

    const nftIdBigInt = BigInt(nftId);

    // Map OrderType to contract enum value
    // Contract: STOP_LOSS = 0, TAKE_PROFIT = 1
    const orderTypeMap: Record<OrderType, number> = {
      'STOP_LOSS': 0,
      'TAKE_PROFIT': 1,
    };
    const orderTypeValue = orderTypeMap[params.orderType];

    // Call the appropriate contract function based on update type
    switch (params.updateType) {
      case 'triggerTick':
        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'setTriggerTick',
          args: [nftIdBigInt, orderTypeValue, params.triggerTick],
          chainId,
        });
        break;

      case 'slippage':
        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'setSlippage',
          args: [nftIdBigInt, orderTypeValue, params.slippageBps],
          chainId,
        });
        break;

      case 'payout':
        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'setPayout',
          args: [nftIdBigInt, orderTypeValue, params.payoutAddress],
          chainId,
        });
        break;

      case 'validUntil':
        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'setValidUntil',
          args: [nftIdBigInt, orderTypeValue, params.validUntil],
          chainId,
        });
        break;

      case 'operator':
        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'setOperator',
          args: [nftIdBigInt, orderTypeValue, params.operatorAddress],
          chainId,
        });
        break;

      case 'swapIntent': {
        // Map SwapDirection to contract enum value
        // Contract: NONE = 0, TOKEN0_TO_1 = 1, TOKEN1_TO_0 = 2
        const swapDirectionMap: Record<string, number> = {
          'NONE': 0,
          'TOKEN0_TO_1': 1,
          'TOKEN1_TO_0': 2,
        };
        const directionValue = swapDirectionMap[params.direction] ?? 0;

        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'setSwapIntent',
          args: [nftIdBigInt, orderTypeValue, directionValue, params.swapSlippageBps],
          chainId,
        });
        break;
      }
    }
  }, [writeContract, isReady, abi, contractAddress, chainId, nftId]);

  // Reset function
  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
    setCurrentParams(null);
  }, [resetWrite]);

  return {
    updateOrder,
    isUpdating: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
    isReady,
  };
}
