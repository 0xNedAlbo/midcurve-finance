/**
 * FreeFormSwapWidget Component
 *
 * Full-featured swap interface for the standalone swap dialog.
 * Uses MidcurveSwapRouter for quoting and execution.
 * SELL mode only — user specifies exact input amount.
 */

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { parseUnits, formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';

/**
 * Format a bigint balance for display
 */
function formatBalance(balance: bigint, decimals: number): string {
  const formatted = formatUnits(balance, decimals);
  const num = parseFloat(formatted);

  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(4);
  if (num < 1000000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${(num / 1000000).toFixed(2)}M`;
}

import { useRouterSwapQuote, useSwapApproval, useRouterExecuteSwap } from '@/hooks/swap';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';
import { getChainSlugByChainId } from '@/config/chains';
import { SourceTokenSelector } from './source-token-selector';
import { TokenAmountInput } from './token-amount-input';
import { RouterQuoteDisplay } from './router-quote-display';
import { DeviationSettings } from './deviation-settings';
import { SwapButton } from './swap-button';

/**
 * Parse swap error messages to extract user-friendly messages
 */
function parseSwapError(error: Error | null): string | null {
  if (!error) return null;

  const message = error.message || '';

  // Common wallet errors
  if (message.includes('User rejected') || message.includes('user rejected')) {
    return 'Transaction rejected by user';
  }
  if (message.includes('insufficient funds')) {
    return 'Insufficient funds for transaction';
  }

  return message;
}

export interface FreeFormSwapWidgetProps {
  chainId: number;
  swapRouterAddress: string | null;
  onClose: (reason: 'success' | 'cancelled' | 'error') => void;
  onSwapSuccess?: () => void;
}

/**
 * Free-form swap widget for standalone token swapping
 *
 * Features:
 * - Select both source and destination tokens
 * - SELL mode only (fixed input amount)
 * - Real-time quote with fair value comparison
 * - Hop route visualization
 * - Configurable max deviation from fair value
 * - Token approval flow
 */
export function FreeFormSwapWidget({
  chainId,
  swapRouterAddress,
  onClose,
  onSwapSuccess,
}: FreeFormSwapWidgetProps) {
  const { address: userAddress } = useAccount();

  // State
  const [sourceToken, setSourceToken] = useState<SwapToken | null>(null);
  const [destToken, setDestToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [deviationBps, setDeviationBps] = useState(100); // 1% default

  // Get chain slug for token search
  const chainSlug = getChainSlugByChainId(chainId);

  // Calculate amount in wei
  const amountInWei = useMemo(() => {
    if (!amount || amount === '0') return undefined;
    if (!sourceToken) return undefined;

    try {
      return parseUnits(amount, sourceToken.decimals).toString();
    } catch {
      return undefined;
    }
  }, [amount, sourceToken]);

  // Get quote from MidcurveSwapRouter
  const {
    quote,
    isLoading: isLoadingQuote,
    isFetching: isFetchingQuote,
    refreshQuote,
  } = useRouterSwapQuote({
    chainId,
    tokenIn: sourceToken?.address,
    tokenInDecimals: sourceToken?.decimals,
    tokenOut: destToken?.address,
    tokenOutDecimals: destToken?.decimals,
    amountIn: amountInWei,
    maxDeviationBps: deviationBps,
    enabled: !!sourceToken && !!destToken && !!amountInWei && !!userAddress,
    autoRefresh: true,
  });

  // Token approval — spender is the swap router
  const {
    isApproved,
    needsApproval,
    isLoadingAllowance,
    approve,
    isApproving,
    isWaitingForConfirmation: isApprovalConfirming,
    approvalError,
  } = useSwapApproval({
    tokenAddress: sourceToken?.address as Address | null,
    ownerAddress: userAddress as Address | null,
    spenderAddress: swapRouterAddress as Address | null,
    requiredAmount: amountInWei ? BigInt(amountInWei) : 0n,
    chainId,
    enabled: !!sourceToken && !!swapRouterAddress && !!amountInWei && !!userAddress,
  });

  // Source token balance
  const {
    balanceBigInt: sourceTokenBalance,
    isLoading: isLoadingSourceBalance,
  } = useErc20TokenBalance({
    chainId,
    tokenAddress: sourceToken?.address ?? null,
    walletAddress: userAddress ?? null,
    enabled: !!sourceToken && !!userAddress,
  });

  // Destination token balance
  const {
    balanceBigInt: destTokenBalance,
    isLoading: isLoadingDestBalance,
  } = useErc20TokenBalance({
    chainId,
    tokenAddress: destToken?.address ?? null,
    walletAddress: userAddress ?? null,
    enabled: !!destToken && !!userAddress,
  });

  // Check insufficient balance
  const insufficientBalance = useMemo(() => {
    if (!amountInWei || sourceTokenBalance === undefined) return false;
    return sourceTokenBalance < BigInt(amountInWei);
  }, [amountInWei, sourceTokenBalance]);

  // Execute swap via writeContract to MidcurveSwapRouter.sell()
  const {
    executeSwap,
    isExecuting,
    isWaitingForConfirmation: isSwapConfirming,
    isSuccess,
    error: swapError,
  } = useRouterExecuteSwap({
    chainId,
    userAddress: userAddress as Address | undefined,
  });

  // Handle successful swap
  useEffect(() => {
    if (isSuccess) {
      onSwapSuccess?.();
      const timer = setTimeout(() => {
        onClose('success');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, onSwapSuccess, onClose]);

  // Handle swap execution
  const handleSwap = useCallback(() => {
    if (!quote) return;
    executeSwap({ quote });
  }, [quote, executeSwap]);

  // Handle MAX button click
  const handleMaxClick = useCallback(() => {
    if (sourceTokenBalance !== undefined && sourceToken) {
      const balanceStr = (Number(sourceTokenBalance) / Math.pow(10, sourceToken.decimals)).toString();
      setAmount(balanceStr);
    }
  }, [sourceTokenBalance, sourceToken]);

  const isDoNotExecute = quote?.kind === 'do_not_execute';

  return (
    <div className="space-y-4">
      {/* Source Token Selector */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-slate-400">From</span>
          {sourceToken && (
            <span className="text-xs text-slate-500">
              {isLoadingSourceBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : sourceTokenBalance !== undefined ? (
                <>Balance: {formatBalance(sourceTokenBalance, sourceToken.decimals)} {sourceToken.symbol}</>
              ) : null}
            </span>
          )}
        </div>
        {chainSlug && (
          <SourceTokenSelector
            chain={chainSlug}
            selectedToken={sourceToken}
            onSelect={setSourceToken}
            excludeAddresses={destToken ? [destToken.address] : []}
          />
        )}
      </div>

      {/* Destination Token Selector */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-slate-400">To</span>
          {destToken && (
            <span className="text-xs text-slate-500">
              {isLoadingDestBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : destTokenBalance !== undefined ? (
                <>Balance: {formatBalance(destTokenBalance, destToken.decimals)} {destToken.symbol}</>
              ) : null}
            </span>
          )}
        </div>
        {chainSlug && (
          <SourceTokenSelector
            chain={chainSlug}
            selectedToken={destToken}
            onSelect={setDestToken}
            excludeAddresses={sourceToken ? [sourceToken.address] : []}
          />
        )}
      </div>

      {/* Amount Input */}
      <TokenAmountInput
        value={amount}
        onChange={setAmount}
        token={sourceToken}
        label="Amount to sell"
        balance={sourceTokenBalance}
        decimals={sourceToken?.decimals}
        disabled={!sourceToken || !destToken}
        showMaxButton={true}
        onMaxClick={handleMaxClick}
      />

      {/* Quote Display */}
      {sourceToken && destToken && amountInWei && (
        <RouterQuoteDisplay
          quote={quote}
          isLoading={isLoadingQuote}
          isFetching={isFetchingQuote}
          onRefresh={refreshQuote}
          sourceToken={sourceToken}
          destToken={destToken}
        />
      )}

      {/* Deviation Settings */}
      <DeviationSettings
        deviationBps={deviationBps}
        onDeviationChange={setDeviationBps}
      />

      {/* Error Display */}
      {(approvalError || swapError) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 text-sm">
            {parseSwapError(approvalError) || parseSwapError(swapError)}
          </p>
        </div>
      )}

      {/* Swap Button */}
      <SwapButton
        hasSourceToken={!!sourceToken && !!destToken}
        hasQuote={!!quote}
        isExpired={false}
        isDoNotExecute={isDoNotExecute}
        insufficientBalance={insufficientBalance}
        isLoadingBalance={isLoadingSourceBalance || (sourceTokenBalance === undefined && !!sourceToken && !!userAddress)}
        needsApproval={needsApproval}
        isLoadingAllowance={isLoadingAllowance}
        isApproved={isApproved}
        isApproving={isApproving || isApprovalConfirming}
        isSwapping={isExecuting || isSwapConfirming}
        isSuccess={isSuccess}
        sourceSymbol={sourceToken?.symbol}
        onApprove={approve}
        onSwap={handleSwap}
        onRefresh={refreshQuote}
      />
    </div>
  );
}
