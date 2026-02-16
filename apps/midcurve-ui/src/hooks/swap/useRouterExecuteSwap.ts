/**
 * Router Execute Swap Hook
 *
 * Executes swaps via direct writeContract to MidcurveSwapRouter.sell().
 * Replaces useExecuteSwap for the SwapDialog context.
 */

import { useState, useCallback } from 'react';
import type { Address } from 'viem';
import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import type { RouterSwapQuoteData } from '@midcurve/api-shared';

const SWAP_ROUTER_SELL_ABI = [
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      {
        name: 'path',
        type: 'tuple[]',
        components: [
          { name: 'venueId', type: 'bytes32' },
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'venueData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export interface UseRouterExecuteSwapParams {
  chainId: number | undefined;
  userAddress: Address | undefined;
  enabled?: boolean;
}

export interface RouterExecuteSwapInput {
  quote: RouterSwapQuoteData;
}

export interface UseRouterExecuteSwapResult {
  executeSwap: (input: RouterExecuteSwapInput) => Promise<void>;
  isExecuting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  txHash: Address | undefined;
  error: Error | null;
  reset: () => void;
}

/**
 * Hook to execute swap transactions via MidcurveSwapRouter.sell()
 *
 * Flow:
 * 1. Call writeContract with sell() args from quote
 * 2. Wait for on-chain confirmation
 */
export function useRouterExecuteSwap({
  chainId,
  userAddress,
  enabled = true,
}: UseRouterExecuteSwapParams): UseRouterExecuteSwapResult {
  const [error, setError] = useState<Error | null>(null);

  const {
    writeContractAsync,
    data: txHash,
    isPending: isExecuting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isWaitingForConfirmation,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId,
  });

  const executeSwap = useCallback(
    async (input: RouterExecuteSwapInput) => {
      if (!enabled || !chainId || !userAddress) {
        setError(new Error('Missing required parameters'));
        return;
      }

      const { quote } = input;

      if (quote.kind !== 'execute') {
        setError(new Error(`Cannot execute swap: ${quote.reason || 'conditions unfavorable'}`));
        return;
      }

      setError(null);

      try {
        const path = quote.encodedHops.map((hop) => ({
          venueId: hop.venueId as `0x${string}`,
          tokenIn: hop.tokenIn as Address,
          tokenOut: hop.tokenOut as Address,
          venueData: hop.venueData as `0x${string}`,
        }));

        await writeContractAsync({
          address: quote.swapRouterAddress as Address,
          abi: SWAP_ROUTER_SELL_ABI,
          functionName: 'sell',
          args: [
            quote.tokenIn as Address,
            quote.tokenOut as Address,
            BigInt(quote.amountIn),
            BigInt(quote.minAmountOut),
            userAddress,
            BigInt(quote.deadline),
            path,
          ] as any, // viem strict type inference requires cast for tuple[] ABI
          chainId,
        });
      } catch (err) {
        setError(err as Error);
      }
    },
    [enabled, chainId, userAddress, writeContractAsync]
  );

  const combinedError = error || writeError || receiptError || null;

  const reset = useCallback(() => {
    setError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    executeSwap,
    isExecuting,
    isWaitingForConfirmation,
    isSuccess,
    txHash,
    error: combinedError,
    reset,
  };
}
