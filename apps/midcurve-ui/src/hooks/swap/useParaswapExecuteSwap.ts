/**
 * Paraswap Execute Swap Hook
 *
 * Builds swap transaction via Paraswap API and submits it via wagmi.
 * No backend involvement — calls Paraswap directly from the browser.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Address } from 'viem';
import { useSendTransaction } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import {
  buildParaswapTransaction,
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
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
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

  // Watch for tx confirmation via backend subscription
  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId: chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!txHash,
  });
  const isWaitingForConfirmation =
    !!txHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';

  useEffect(() => {
    if (sendError) setError(sendError);
  }, [sendError]);

  useEffect(() => {
    if (txWatch.status === 'reverted') setError(new Error('Transaction reverted'));
  }, [txWatch.status]);

  const executeSwap = useCallback(
    async (input: ParaswapExecuteSwapInput) => {
      if (!chainId || !userAddress) {
        setError(new Error('Wallet not connected'));
        return;
      }

      setIsPreparing(true);
      setError(null);

      const { quote, slippageBps } = input;

      const txResult = await buildParaswapTransaction({
        chainId: chainId as ParaswapSupportedChainId,
        srcToken: quote.srcToken,
        destToken: quote.destToken,
        srcAmount: quote.srcAmount,
        destAmount: quote.destAmount,
        priceRoute: quote.priceRoute,
        userAddress,
        slippageBps,
      });

      setIsPreparing(false);

      sendTransaction({
        to: txResult.to,
        data: txResult.data,
        value: BigInt(txResult.value),
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
    isWaitingForConfirmation,
    isSuccess,
    txHash,
    error,
    reset,
  };
}
