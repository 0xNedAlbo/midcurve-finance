/**
 * FreeFormSwapWidget Component
 *
 * Full-featured swap interface for the standalone swap dialog.
 * Unlike SwapWidget, this allows selecting BOTH source and destination tokens.
 * Supports both SELL (exact input) and BUY (exact output) swap modes.
 */

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { parseUnits, formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';
import { ArrowDownUp } from 'lucide-react';

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

import { useSwapQuote, useSwapApproval, useExecuteSwap } from '@/hooks/swap';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';
import { getChainSlugByChainId } from '@/config/chains';
import { SourceTokenSelector } from './source-token-selector';
import { TokenAmountInput } from './token-amount-input';
import { QuoteDisplay } from './quote-display';
import { SlippageSettings } from './slippage-settings';
import { SwapButton } from './swap-button';

/**
 * Parse ParaSwap error messages to extract user-friendly messages
 */
function parseSwapError(error: Error | null): string | null {
  if (!error) return null;

  const message = error.message || '';

  // Try to extract from details if available (ApiError structure from api-client)
  const errorWithDetails = error as Error & { details?: unknown };
  if (errorWithDetails.details && typeof errorWithDetails.details === 'string') {
    const detailsMatch = errorWithDetails.details.match(/\{[^}]*"error"\s*:\s*"([^"]+)"[^}]*\}/);
    if (detailsMatch) {
      return detailsMatch[1];
    }
    if (!errorWithDetails.details.startsWith('ParaSwap')) {
      return errorWithDetails.details;
    }
  }

  // Try to extract ParaSwap error from JSON in the message itself
  const jsonMatch = message.match(/\{[^}]*"error"\s*:\s*"([^"]+)"[^}]*\}/);
  if (jsonMatch) {
    return jsonMatch[1];
  }

  // Common wallet errors
  if (message.includes('User rejected') || message.includes('user rejected')) {
    return 'Transaction rejected by user';
  }
  if (message.includes('insufficient funds')) {
    return 'Insufficient funds for transaction';
  }

  // Handle generic API errors
  if (message.includes('EXTERNAL_SERVICE_ERROR') || message.includes('Failed to build swap')) {
    return 'Swap service temporarily unavailable. Please try again.';
  }

  return message;
}

export interface FreeFormSwapWidgetProps {
  chainId: number;
  onClose: (reason: 'success' | 'cancelled' | 'error') => void;
  onSwapSuccess?: () => void;
}

/**
 * Free-form swap widget for standalone token swapping
 *
 * Features:
 * - Select both source and destination tokens
 * - Toggle between SELL (exact input) and BUY (exact output)
 * - Flip button to swap token directions
 * - Real-time quote with expiration countdown
 * - Configurable slippage
 * - Token approval flow
 */
export function FreeFormSwapWidget({
  chainId,
  onClose,
  onSwapSuccess,
}: FreeFormSwapWidgetProps) {
  const { address: userAddress } = useAccount();

  // State
  const [sourceToken, setSourceToken] = useState<SwapToken | null>(null);
  const [destToken, setDestToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [side, setSide] = useState<'SELL' | 'BUY'>('SELL');
  const [slippageBps, setSlippageBps] = useState(50); // 0.5% default

  // Get chain slug for token search
  const chainSlug = getChainSlugByChainId(chainId);

  // Calculate amount in wei for the quote
  const amountInWei = useMemo(() => {
    if (!amount || amount === '0') return undefined;

    const relevantToken = side === 'SELL' ? sourceToken : destToken;
    if (!relevantToken) return undefined;

    try {
      return parseUnits(amount, relevantToken.decimals).toString();
    } catch {
      return undefined;
    }
  }, [amount, side, sourceToken, destToken]);

  // Get quote
  const {
    quote,
    isLoading: isLoadingQuote,
    isFetching: isFetchingQuote,
    isExpired,
    secondsUntilExpiry,
    refreshQuote,
  } = useSwapQuote({
    chainId,
    srcToken: sourceToken?.address,
    srcDecimals: sourceToken?.decimals,
    destToken: destToken?.address,
    destDecimals: destToken?.decimals,
    amount: amountInWei,
    userAddress: userAddress,
    side,
    slippageBps,
    enabled: !!sourceToken && !!destToken && !!amountInWei && !!userAddress,
    autoRefresh: true,
  });

  // Token approval
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
    spenderAddress: quote?.tokenTransferProxy as Address | null,
    requiredAmount: quote ? BigInt(quote.srcAmount) : 0n,
    chainId,
    enabled: !!sourceToken && !!quote && !!userAddress,
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
    if (!quote || sourceTokenBalance === undefined) return false;
    const requiredAmount = BigInt(quote.srcAmount);
    return sourceTokenBalance < requiredAmount;
  }, [quote, sourceTokenBalance]);

  // Execute swap
  const {
    executeSwap,
    isPreparing,
    isExecuting,
    isWaitingForConfirmation: isSwapConfirming,
    isSuccess,
    error: swapError,
  } = useExecuteSwap({
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
    executeSwap({ quote, slippageBps });
  }, [quote, slippageBps, executeSwap]);

  // Flip tokens (swap source and destination)
  const handleFlipTokens = useCallback(() => {
    const temp = sourceToken;
    setSourceToken(destToken);
    setDestToken(temp);
    // Also flip side when flipping tokens
    setSide((prev) => (prev === 'SELL' ? 'BUY' : 'SELL'));
    // Clear amount to avoid confusion
    setAmount('');
  }, [sourceToken, destToken]);

  // Handle MAX button click
  const handleMaxClick = useCallback(() => {
    if (sourceTokenBalance !== undefined && sourceToken) {
      // Format the balance as a decimal string
      const balanceStr = (Number(sourceTokenBalance) / Math.pow(10, sourceToken.decimals)).toString();
      setAmount(balanceStr);
      // Switch to SELL mode when using MAX
      setSide('SELL');
    }
  }, [sourceTokenBalance, sourceToken]);

  // Labels based on swap side
  const amountLabel = side === 'SELL' ? 'Amount to sell' : 'Amount to buy';

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

      {/* Flip Button */}
      <div className="flex justify-center -my-2">
        <button
          onClick={handleFlipTokens}
          disabled={!sourceToken && !destToken}
          className="
            p-2 rounded-full
            bg-slate-700/50 hover:bg-slate-600/50
            border border-slate-600/50 hover:border-slate-500/50
            text-slate-400 hover:text-white
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            cursor-pointer
          "
          title="Swap tokens"
        >
          <ArrowDownUp className="w-4 h-4" />
        </button>
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
        token={side === 'SELL' ? sourceToken : destToken}
        label={amountLabel}
        balance={side === 'SELL' ? sourceTokenBalance : undefined}
        decimals={side === 'SELL' ? sourceToken?.decimals : destToken?.decimals}
        disabled={!sourceToken || !destToken}
        showMaxButton={side === 'SELL'}
        onMaxClick={handleMaxClick}
      />

      {/* Side Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setSide('SELL')}
          className={`
            flex-1 py-2 px-4 rounded-lg text-sm font-medium
            transition-colors cursor-pointer
            ${side === 'SELL'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-slate-700/30 text-slate-400 border border-slate-600/30 hover:bg-slate-700/50'
            }
          `}
        >
          Sell
        </button>
        <button
          onClick={() => setSide('BUY')}
          className={`
            flex-1 py-2 px-4 rounded-lg text-sm font-medium
            transition-colors cursor-pointer
            ${side === 'BUY'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-slate-700/30 text-slate-400 border border-slate-600/30 hover:bg-slate-700/50'
            }
          `}
        >
          Buy
        </button>
      </div>

      {/* Quote Display */}
      {sourceToken && destToken && amountInWei && (
        <QuoteDisplay
          quote={quote}
          isLoading={isLoadingQuote || isFetchingQuote}
          isExpired={isExpired}
          secondsUntilExpiry={secondsUntilExpiry}
          onRefresh={refreshQuote}
          sourceToken={sourceToken}
          destToken={destToken}
        />
      )}

      {/* Slippage Settings */}
      <SlippageSettings
        slippageBps={slippageBps}
        onSlippageChange={setSlippageBps}
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
        isExpired={isExpired}
        insufficientBalance={insufficientBalance}
        isLoadingBalance={isLoadingSourceBalance || (sourceTokenBalance === undefined && !!sourceToken && !!userAddress)}
        needsApproval={needsApproval}
        isLoadingAllowance={isLoadingAllowance}
        isApproved={isApproved}
        isApproving={isApproving || isApprovalConfirming}
        isSwapping={isPreparing || isExecuting || isSwapConfirming}
        isSuccess={isSuccess}
        sourceSymbol={sourceToken?.symbol}
        onApprove={approve}
        onSwap={handleSwap}
        onRefresh={refreshQuote}
      />
    </div>
  );
}
