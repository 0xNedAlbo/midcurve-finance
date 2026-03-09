/**
 * Paraswap Execute Swap Hook
 *
 * Fetches fresh quote + tx calldata via Velora's /swap endpoint and submits via wagmi.
 * No backend involvement — calls Paraswap directly from the browser.
 *
 * If the fresh quote's srcAmount exceeds the current allowance, the hook
 * exposes `freshSrcAmount` so the widget can update the approval requirement
 * instead of submitting a tx that would revert.
 *
 * Transaction confirmation tracking is handled by EvmTransactionPrompt,
 * not by this hook.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Address } from 'viem';
import { erc20Abi } from 'viem';
import { useSendTransaction, useReadContract } from 'wagmi';
import {
  getParaswapSwap,
  type ParaswapQuoteResult,
  type ParaswapSupportedChainId,
} from '@/lib/paraswap-client';

export interface UseParaswapExecuteSwapParams {
  chainId: number | undefined;
  userAddress: Address | undefined;
  /** Source token address — needed to read allowance before submitting */
  srcTokenAddress: Address | undefined;
  /** Spender address (tokenTransferProxy) — needed to read allowance */
  spenderAddress: Address | undefined;
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
  /** The srcAmount from the most recent /swap call, if it required more approval */
  freshSrcAmount: bigint | null;
  reset: () => void;
}

export function useParaswapExecuteSwap({
  chainId,
  userAddress,
  srcTokenAddress,
  spenderAddress,
}: UseParaswapExecuteSwapParams): UseParaswapExecuteSwapResult {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [freshSrcAmount, setFreshSrcAmount] = useState<bigint | null>(null);

  const {
    sendTransaction,
    data: txHash,
    isPending: isExecuting,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  // Read current allowance for pre-submission check
  const { refetch: refetchAllowance } = useReadContract({
    address: srcTokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: userAddress && spenderAddress ? [userAddress, spenderAddress] : undefined,
    chainId,
    query: {
      enabled: !!srcTokenAddress && !!userAddress && !!spenderAddress && !!chainId,
    },
  });

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
      setFreshSrcAmount(null);

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

      // Check if current allowance covers the fresh srcAmount
      const freshAmount = BigInt(swapResult.srcAmount);
      const { data: currentAllowance } = await refetchAllowance();
      const allowance = currentAllowance !== undefined ? BigInt(currentAllowance.toString()) : 0n;

      if (allowance < freshAmount) {
        // Approval insufficient — expose fresh amount so widget can update approval
        setFreshSrcAmount(freshAmount);
        setIsPreparing(false);
        return;
      }

      setIsPreparing(false);

      sendTransaction({
        to: swapResult.to,
        data: swapResult.data,
        value: BigInt(swapResult.value),
        chainId,
      });
    },
    [chainId, userAddress, sendTransaction, refetchAllowance]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPreparing(false);
    setFreshSrcAmount(null);
    resetSend();
  }, [resetSend]);

  return {
    executeSwap,
    isPreparing,
    isExecuting,
    txHash,
    error,
    freshSrcAmount,
    reset,
  };
}
