/**
 * useRegisterCloseOrder - Register SL/TP close orders with UniswapV3PositionCloser contract
 *
 * This hook handles registration of stop-loss and take-profit orders
 * that automatically close a UniswapV3 position when the trigger tick is reached.
 *
 * Flow:
 * 1. Build RegisterOrderParams struct
 * 2. Call registerOrder() on PositionCloser contract
 * 3. Wait for transaction confirmation
 * 4. Order is now active and monitored by the automation system
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Address, Hash } from 'viem';
import { POSITION_CLOSER_ABI } from '@/abis/UniswapV3PositionCloser';
import {
  getPositionCloserAddress,
  type TriggerModeValue,
  type SwapDirectionValue,
  DEFAULT_CLOSE_ORDER_SLIPPAGE,
} from '@/config/automation-contracts';

/**
 * Parameters for registering a close order
 */
export interface RegisterCloseOrderParams {
  /** Position NFT ID */
  nftId: bigint;
  /** Pool address */
  poolAddress: Address;
  /** Trigger mode: 0 = LOWER (SL), 1 = UPPER (TP) */
  triggerMode: TriggerModeValue;
  /** Tick at which order triggers */
  triggerTick: number;
  /** Address to receive funds after close */
  payoutAddress: Address;
  /** Automation wallet address (operator) */
  operatorAddress: Address;
  /** Unix timestamp when order expires (0 = never) */
  validUntil?: bigint;
  /** Slippage tolerance for liquidity decrease in basis points (default: 50 = 0.5%) */
  slippageBps?: number;
  /** Direction of post-close swap: 0=NONE, 1=TOKEN0_TO_1, 2=TOKEN1_TO_0 */
  swapDirection: SwapDirectionValue;
  /** Slippage tolerance for swap in basis points (default: 100 = 1%) */
  swapSlippageBps?: number;
  /** Chain ID for the transaction */
  chainId: number;
}

/**
 * Hook result
 */
export interface UseRegisterCloseOrderResult {
  /** Register a close order */
  register: (params: RegisterCloseOrderParams) => void;
  /** Whether registration tx is pending (user signing) */
  isRegistering: boolean;
  /** Whether waiting for tx confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether registration succeeded */
  isSuccess: boolean;
  /** Transaction hash */
  txHash: Hash | undefined;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
}

/**
 * Hook for registering stop-loss and take-profit orders
 *
 * @example
 * ```tsx
 * const { register, isRegistering, isWaitingForConfirmation, error } = useRegisterCloseOrder();
 *
 * const handleRegisterSL = () => {
 *   register({
 *     nftId: positionId,
 *     poolAddress: pool.address,
 *     triggerMode: TriggerMode.LOWER, // Stop loss
 *     triggerTick: stopLossTick,
 *     payoutAddress: userAddress,
 *     operatorAddress: autowalletAddress,
 *     swapDirection: SwapDirection.TOKEN0_TO_1, // Swap to quote token
 *     chainId: 1,
 *   });
 * };
 * ```
 */
export function useRegisterCloseOrder(): UseRegisterCloseOrderResult {
  const [error, setError] = useState<Error | null>(null);

  // Write contract hook for registration
  const {
    writeContract,
    data: txHash,
    isPending: isRegistering,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Register function
  const register = useCallback(
    (params: RegisterCloseOrderParams) => {
      const {
        nftId,
        poolAddress,
        triggerMode,
        triggerTick,
        payoutAddress,
        operatorAddress,
        validUntil = 0n,
        slippageBps = DEFAULT_CLOSE_ORDER_SLIPPAGE.liquidityBps,
        swapDirection,
        swapSlippageBps = DEFAULT_CLOSE_ORDER_SLIPPAGE.swapBps,
        chainId,
      } = params;

      // Get contract address for this chain
      const positionCloserAddress = getPositionCloserAddress(chainId);

      if (!positionCloserAddress) {
        setError(new Error(`Automation not supported on chain ${chainId}`));
        return;
      }

      setError(null);

      // Build the params struct for registerOrder
      const orderParams = {
        nftId,
        pool: poolAddress,
        triggerMode,
        triggerTick,
        payout: payoutAddress,
        operator: operatorAddress,
        validUntil,
        slippageBps,
        swapDirection,
        swapSlippageBps,
      };

      writeContract({
        address: positionCloserAddress,
        abi: POSITION_CLOSER_ABI,
        functionName: 'registerOrder',
        args: [orderParams],
        chainId,
      });
    },
    [writeContract]
  );

  // Reset function
  const reset = useCallback(() => {
    resetWrite();
    setError(null);
  }, [resetWrite]);

  return {
    register,
    isRegistering,
    isWaitingForConfirmation,
    isSuccess,
    txHash,
    error,
    reset,
  };
}
