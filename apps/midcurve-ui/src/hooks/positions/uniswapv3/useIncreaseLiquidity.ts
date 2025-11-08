import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
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
  addedLiquidity: bigint | undefined;
  isSuccess: boolean;
  receipt: import('viem').TransactionReceipt | undefined;

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
  const [addedLiquidity, setAddedLiquidity] = useState<bigint | undefined>(
    undefined
  );

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

  // Wait for increase transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash: increaseTxHash,
    chainId: params?.chainId,
  });

  // Handle increase errors
  useEffect(() => {
    if (writeError) {
      setIncreaseError(writeError);
    }
  }, [writeError]);

  // Extract added liquidity from transaction receipt
  useEffect(() => {
    if (isSuccess && receipt) {
      // Find the IncreaseLiquidity event from the NonfungiblePositionManager contract
      // Event signature: IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
      const increaseLiquidityLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === managerAddress?.toLowerCase() &&
          log.topics[0] ===
            '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f' // IncreaseLiquidity event signature
      );

      if (increaseLiquidityLog && increaseLiquidityLog.data) {
        try {
          // Liquidity is the first 32 bytes of data (uint128)
          const liquidityHex = '0x' + increaseLiquidityLog.data.slice(2, 66);
          const extractedLiquidity = BigInt(liquidityHex);
          setAddedLiquidity(extractedLiquidity);
        } catch (error) {
          console.error(
            'Failed to extract added liquidity from receipt:',
            error
          );
        }
      }
    }
  }, [isSuccess, receipt, managerAddress]);

  // Increase function
  const increase = () => {
    if (!params || !increaseParams || !managerAddress) {
      setIncreaseError(
        new Error('Missing required parameters for increasing liquidity')
      );
      return;
    }

    setIncreaseError(null);
    setAddedLiquidity(undefined);

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
    setAddedLiquidity(undefined);
  };

  return {
    // Increase transaction
    increase,
    isIncreasing,
    isWaitingForConfirmation,
    increaseError,
    increaseTxHash,

    // Result
    addedLiquidity,
    isSuccess,
    receipt,

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
