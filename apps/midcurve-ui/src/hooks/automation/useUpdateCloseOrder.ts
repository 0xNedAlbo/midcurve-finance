/**
 * useUpdateCloseOrder - Update close order parameters via user's wallet
 *
 * This hook uses Wagmi to have the user sign update transactions
 * directly with their connected wallet. After confirmation, it
 * invalidates the cache and returns success.
 *
 * Available updates:
 * - setCloseBounds(closeId, sqrtPriceX96Lower, sqrtPriceX96Upper)
 * - setCloseSlippage(closeId, slippageBps)
 * - setClosePayout(closeId, payoutAddress)
 * - setCloseValidUntil(closeId, validUntil)
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
import { POSITION_CLOSER_ABI } from '@/config/contracts/uniswapv3-position-closer';

/**
 * Update type enum
 */
export type UpdateType = 'bounds' | 'slippage' | 'payout' | 'validUntil';

/**
 * Base parameters for all updates
 */
interface BaseUpdateParams {
  /** The automation contract address */
  contractAddress: Address;
  /** Chain ID */
  chainId: number;
  /** On-chain close order ID */
  closeId: bigint;
  /** Uniswap V3 NFT token ID (for position-scoped cache invalidation) */
  nftId: string;
  /** Close order semantic hash (e.g., "sl@-12345", "tp@201120") */
  closeOrderHash: string;
  /**
   * Database order ID for cache invalidation
   * @deprecated Derived from closeOrderHash for position-scoped endpoints
   */
  orderId?: string;
  /**
   * Position ID for cache invalidation
   * @deprecated Derived from chainId/nftId for position-scoped endpoints
   */
  positionId?: string;
}

/**
 * Parameters for updating price bounds
 */
export interface UpdateBoundsParams extends BaseUpdateParams {
  updateType: 'bounds';
  sqrtPriceX96Lower: bigint;
  sqrtPriceX96Upper: bigint;
  /** Trigger mode: 'LOWER', 'UPPER', or 'BOTH' */
  triggerMode: 'LOWER' | 'UPPER' | 'BOTH';
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
 * Union type of all update params
 */
export type UpdateCloseOrderParams =
  | UpdateBoundsParams
  | UpdateSlippageParams
  | UpdatePayoutParams
  | UpdateValidUntilParams;

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
}

/**
 * Hook for updating a close order via user's wallet
 */
export function useUpdateCloseOrder(): UseUpdateCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<UpdateCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<UpdateCloseOrderParams | null>(null);

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
  }, [isTxSuccess, txHash, currentParams, queryClient]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Update function
  const updateOrder = useCallback((params: UpdateCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setCurrentParams(params);

    // Call the appropriate contract function based on update type
    switch (params.updateType) {
      case 'bounds': {
        // Map TriggerMode string to contract enum value
        // Contract: LOWER_ONLY = 0, UPPER_ONLY = 1, BOTH = 2
        const triggerModeMap: Record<string, number> = {
          'LOWER': 0,
          'UPPER': 1,
          'BOTH': 2,
        };
        const mode = triggerModeMap[params.triggerMode] ?? 0;

        writeContract({
          address: params.contractAddress,
          abi: POSITION_CLOSER_ABI,
          functionName: 'setCloseBounds',
          args: [params.closeId, params.sqrtPriceX96Lower, params.sqrtPriceX96Upper, mode],
          chainId: params.chainId,
        });
        break;
      }

      case 'slippage':
        writeContract({
          address: params.contractAddress,
          abi: POSITION_CLOSER_ABI,
          functionName: 'setCloseSlippage',
          args: [params.closeId, params.slippageBps],
          chainId: params.chainId,
        });
        break;

      case 'payout':
        writeContract({
          address: params.contractAddress,
          abi: POSITION_CLOSER_ABI,
          functionName: 'setClosePayout',
          args: [params.closeId, params.payoutAddress],
          chainId: params.chainId,
        });
        break;

      case 'validUntil':
        writeContract({
          address: params.contractAddress,
          abi: POSITION_CLOSER_ABI,
          functionName: 'setCloseValidUntil',
          args: [params.closeId, params.validUntil],
          chainId: params.chainId,
        });
        break;
    }
  }, [writeContract]);

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
  };
}
