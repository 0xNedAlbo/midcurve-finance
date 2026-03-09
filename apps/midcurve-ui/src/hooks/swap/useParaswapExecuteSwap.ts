/**
 * Paraswap Execute Swap Hook
 *
 * Builds swap transaction via Paraswap API and submits it via wagmi.
 * No backend involvement — calls Paraswap directly from the browser.
 *
 * Transaction confirmation tracking is handled by EvmTransactionPrompt,
 * not by this hook.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Address } from 'viem';
import { useSendTransaction } from 'wagmi';
import {
  getParaswapSwap,
  type ParaswapQuoteResult,
  type ParaswapSupportedChainId,
} from '@/lib/paraswap-client';

export interface UseParaswapExecuteSwapParams {
  chainId: number | undefined;
  userAddress: Address | undefined;
}

export interface ParaswapExecuteSwapInput {
  quote: ParaswapQuoteResult;
  slippageBps: number;
}

export interface UseParaswapExecuteSwapResult {
  executeSwap: (input: ParaswapExecuteSwapInput) => Promise<void>;
  isPreparing: boolean;
  isExecuting: boolean;
  txHash: Address | undefined;
  error: Error | null;
  reset: () => void;
}

export function useParaswapExecuteSwap({
  chainId,
  userAddress,
}: UseParaswapExecuteSwapParams): UseParaswapExecuteSwapResult {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const {
    sendTransaction,
    data: txHash,
    isPending: isExecuting,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  useEffect(() => {
    if (sendError) setError(sendError);
  }, [sendError]);

  const executeSwap = useCallback(
    async (input: ParaswapExecuteSwapInput) => {
      if (!chainId || !userAddress) {
        setError(new Error('Wallet not connected'));
        return;
      }

      setIsPreparing(true);
      setError(null);

      const { quote, slippageBps } = input;

      // Use /swap endpoint: fetches fresh quote + tx calldata in one atomic call,
      // eliminating staleness between quote and transaction build.
      const swapResult = await getParaswapSwap({
        chainId: chainId as ParaswapSupportedChainId,
        srcToken: quote.srcToken,
        srcDecimals: quote.priceRoute.srcDecimals,
        destToken: quote.destToken,
        destDecimals: quote.priceRoute.destDecimals,
        amount: quote.side === 'SELL' ? quote.srcAmount : quote.destAmount,
        userAddress,
        side: quote.side,
        slippageBps,
      });

      setIsPreparing(false);

      sendTransaction({
        to: swapResult.to,
        data: swapResult.data,
        value: BigInt(swapResult.value),
        chainId,
      });
    },
    [chainId, userAddress, sendTransaction]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPreparing(false);
    resetSend();
  }, [resetSend]);

  return {
    executeSwap,
    isPreparing,
    isExecuting,
    txHash,
    error,
    reset,
  };
}
