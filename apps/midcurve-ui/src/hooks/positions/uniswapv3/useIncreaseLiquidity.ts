import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import {
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
} from '@/config/contracts/nonfungible-position-manager';

export interface IncreaseLiquidityParams {
  tokenId: bigint;
  amount0Desired: bigint;
  amount1Desired: bigint;
  chainId: number;
  slippageBps?: number; // Slippage in basis points (default: 50 = 0.5%)
}

export interface UseIncreaseLiquidityResult {
  // Increase transaction
  increase: () => void;
  isIncreasing: boolean;
  isWaitingForConfirmation: boolean;
  increaseError: Error | null;
  increaseTxHash: Address | undefined;

  // Result
  isSuccess: boolean;

  // Reset state
  reset: () => void;
}

/**
 * Hook to increase liquidity in an existing Uniswap V3 position
 *
 * Handles:
 * - Calculating slippage-adjusted minimum amounts (default 0.5%)
 * - Setting transaction deadline (20 minutes from now)
 * - Increasing liquidity via NonfungiblePositionManager
 *
 * @param params - Position parameters including tokenId, amounts, and chain
 */
export function useIncreaseLiquidity(
  params: IncreaseLiquidityParams | null
): UseIncreaseLiquidityResult {
  const [increaseError, setIncreaseError] = useState<Error | null>(null);

  const slippageBps = params?.slippageBps ?? 50; // Default 0.5% slippage

  // Get the NonfungiblePositionManager address for this chain
  const managerAddress = params?.chainId
    ? NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[params.chainId]
    : undefined;

  // Prepare increase parameters
  const increaseParams = params
    ? prepareIncreaseParams(params, slippageBps)
    : null;

  // Write contract for increasing liquidity
  const {
    writeContract,
    data: increaseTxHash,
    isPending: isIncreasing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for increase transaction confirmation via backend subscription
  const txWatch = useWatchTransactionStatus({
    txHash: increaseTxHash ?? null,
    chainId: params?.chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!increaseTxHash,
  });
  const isWaitingForConfirmation = !!increaseTxHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  // Handle increase errors (both write errors and receipt errors)
  useEffect(() => {
    if (writeError || receiptError) {
      setIncreaseError(writeError || receiptError);
    }
  }, [writeError, receiptError]);

  // Increase function
  const increase = () => {
    if (!params || !increaseParams || !managerAddress) {
      setIncreaseError(
        new Error('Missing required parameters for increasing liquidity')
      );
      return;
    }

    setIncreaseError(null);

    try {
      writeContract({
        address: managerAddress,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'increaseLiquidity',
        args: [increaseParams],
        chainId: params.chainId,
      });
    } catch (error) {
      setIncreaseError(error as Error);
    }
  };

  // Reset function
  const reset = () => {
    resetWrite();
    setIncreaseError(null);
  };

  return {
    // Increase transaction
    increase,
    isIncreasing,
    isWaitingForConfirmation,
    increaseError,
    increaseTxHash,

    // Result
    isSuccess,

    // Reset
    reset,
  };
}

/**
 * Prepare increase liquidity parameters with slippage protection
 */
function prepareIncreaseParams(
  params: IncreaseLiquidityParams,
  slippageBps: number
) {
  // Calculate slippage-adjusted minimum amounts
  // Apply slippage tolerance: amountMin = amountDesired * (10000 - slippageBps) / 10000
  const amount0Min =
    (params.amount0Desired * BigInt(10000 - slippageBps)) / 10000n;
  const amount1Min =
    (params.amount1Desired * BigInt(10000 - slippageBps)) / 10000n;

  // Set deadline to 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

  return {
    tokenId: params.tokenId,
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
    amount0Min,
    amount1Min,
    deadline,
  };
}
