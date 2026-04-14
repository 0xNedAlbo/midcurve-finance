/**
 * Paraswap Execute Swap Hook
 *
 * Fetches fresh quote + tx calldata via Velora's /swap endpoint and submits via wagmi.
 * No backend involvement — calls Paraswap directly from the browser.
 *
 * If the fresh quote's srcAmount exceeds the current allowance (passed via
 * executeSwap input from the backend subscription), the hook exposes
 * `freshSrcAmount` so the widget can update the approval requirement
 * instead of submitting a tx that would revert.
 *
 * Transaction confirmation tracking is handled by EvmTransactionPrompt,
 * not by this hook.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Address } from 'viem';
import { useSendTransaction } from 'wagmi';
import { normalizeAddress, compareAddresses } from '@midcurve/shared';
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
  /** Current allowance from backend subscription, used for pre-submission safety check */
  currentAllowance: bigint | undefined;
  /** The spender address used for the current approval */
  approvedSpender: Address | undefined;
}

export interface UseParaswapExecuteSwapResult {
  executeSwap: (input: ParaswapExecuteSwapInput) => Promise<void>;
  isPreparing: boolean;
  isExecuting: boolean;
  txHash: Address | undefined;
  error: Error | null;
  /** The srcAmount from the most recent /swap call, if it required more approval */
  freshSrcAmount: bigint | null;
  /** The tokenTransferProxy from the most recent /swap call, if it differs from the approved spender */
  freshSpender: Address | null;
  reset: () => void;
}

export function useParaswapExecuteSwap({
  chainId,
  userAddress,
}: UseParaswapExecuteSwapParams): UseParaswapExecuteSwapResult {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [freshSrcAmount, setFreshSrcAmount] = useState<bigint | null>(null);
  const [freshSpender, setFreshSpender] = useState<Address | null>(null);

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
      setFreshSrcAmount(null);
      setFreshSpender(null);

      const { quote, slippageBps, currentAllowance, approvedSpender } = input;

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

      // Check if the /swap endpoint returned a different tokenTransferProxy than
      // what the user approved. Paraswap may route through different contract
      // versions, causing the approved spender to not match.
      const swapSpender = normalizeAddress(swapResult.tokenTransferProxy) as Address;
      if (approvedSpender && compareAddresses(swapSpender, approvedSpender) !== 0) {
        setFreshSpender(swapSpender);
        setIsPreparing(false);
        return;
      }

      // Check if current allowance covers what the calldata will actually transferFrom.
      // In BUY mode, Paraswap's calldata transfers up to srcAmount × (1 + slippage).
      const freshAmount = BigInt(swapResult.srcAmount);
      const requiredAllowance = quote.side === 'BUY'
        ? freshAmount * (10000n + BigInt(slippageBps)) / 10000n
        : freshAmount;
      const allowance = currentAllowance ?? 0n;

      if (allowance < requiredAllowance) {
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
    [chainId, userAddress, sendTransaction]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPreparing(false);
    setFreshSrcAmount(null);
    setFreshSpender(null);
    resetSend();
  }, [resetSend]);

  return {
    executeSwap,
    isPreparing,
    isExecuting,
    txHash,
    error,
    freshSrcAmount,
    freshSpender,
    reset,
  };
}
