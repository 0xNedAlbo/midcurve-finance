/**
 * Execute Swap Hook
 *
 * Handles building and executing swap transactions via ParaSwap.
 */

import { useState, useCallback } from 'react';
import type { Address } from 'viem';
import {
  useSendTransaction,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { swapApi } from '@/lib/api-client';
import type { SwapQuoteData, ParaswapPriceRoute } from '@midcurve/api-shared';

export interface UseExecuteSwapParams {
  chainId: number | undefined;
  userAddress: Address | undefined;
  enabled?: boolean;
}

export interface ExecuteSwapInput {
  quote: SwapQuoteData;
  slippageBps: number;
}

export interface UseExecuteSwapResult {
  // Execution function
  executeSwap: (input: ExecuteSwapInput) => Promise<void>;

  // States
  isPreparing: boolean;
  isExecuting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;

  // Transaction info
  txHash: Address | undefined;

  // Errors
  error: Error | null;

  // Reset
  reset: () => void;
}

/**
 * Hook to execute swap transactions via ParaSwap
 *
 * Flow:
 * 1. Build transaction calldata from quote via API
 * 2. Submit transaction to chain
 * 3. Wait for confirmation
 */
export function useExecuteSwap({
  chainId,
  userAddress,
  enabled = true,
}: UseExecuteSwapParams): UseExecuteSwapResult {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Send raw transaction (for pre-built calldata from ParaSwap)
  const {
    sendTransactionAsync,
    data: txHash,
    isPending: isExecuting,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  // Wait for transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId,
  });

  // Execute swap function
  const executeSwap = useCallback(
    async (input: ExecuteSwapInput) => {
      if (!enabled || !chainId || !userAddress) {
        setError(new Error('Missing required parameters'));
        return;
      }

      const { quote, slippageBps } = input;

      setIsPreparing(true);
      setError(null);

      try {
        // Build transaction via API
        const response = await swapApi.buildTransaction({
          chainId,
          srcToken: quote.srcToken,
          destToken: quote.destToken,
          srcAmount: quote.srcAmount,
          destAmount: quote.destAmount,
          slippageBps,
          userAddress,
          priceRoute: quote.priceRoute as ParaswapPriceRoute,
        });

        const txData = response.data;

        setIsPreparing(false);

        // Execute the raw transaction using sendTransaction
        // ParaSwap returns pre-built calldata, so we use useSendTransaction
        await sendTransactionAsync({
          to: txData.to as Address,
          data: txData.data as `0x${string}`,
          value: BigInt(txData.value || '0'),
          chainId,
          gas: BigInt(txData.gasLimit),
        });
      } catch (err) {
        setIsPreparing(false);
        setError(err as Error);
      }
    },
    [enabled, chainId, userAddress, sendTransactionAsync]
  );

  // Combined error
  const combinedError = error || sendError || receiptError || null;

  // Reset function
  const reset = useCallback(() => {
    setError(null);
    setIsPreparing(false);
    resetSend();
  }, [resetSend]);

  return {
    executeSwap,
    isPreparing,
    isExecuting,
    isWaitingForConfirmation,
    isSuccess,
    txHash,
    error: combinedError,
    reset,
  };
}
