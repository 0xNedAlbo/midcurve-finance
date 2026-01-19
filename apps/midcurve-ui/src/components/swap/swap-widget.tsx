/**
 * SwapWidget Component
 *
 * Custom swap widget using ParaSwap for token acquisition.
 * Designed for target-based swapping (fixed output token/amount).
 */

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { isParaswapSupportedChain, type SwapToken } from '@midcurve/api-shared';

import { useSwapQuote, useSwapApproval, useExecuteSwap } from '@/hooks/swap';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';
import { getChainSlugByChainId } from '@/config/chains';
import { formatCompactValue } from '@/lib/fraction-format';
import { SourceTokenSelector } from './source-token-selector';
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
  // ApiError has: { message, statusCode, code, details }
  const errorWithDetails = error as Error & { details?: unknown };
  if (errorWithDetails.details && typeof errorWithDetails.details === 'string') {
    // Try to extract ParaSwap error from JSON in details
    // Format: "ParaSwap build tx failed: 400 - {\"error\":\"Not enough USDC balance\"}"
    const detailsMatch = errorWithDetails.details.match(/\{[^}]*"error"\s*:\s*"([^"]+)"[^}]*\}/);
    if (detailsMatch) {
      return detailsMatch[1];
    }
    // If details is plain text without JSON, use it
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

  // Handle generic API errors with user-friendly messages
  if (message.includes('EXTERNAL_SERVICE_ERROR') || message.includes('Failed to build swap')) {
    return 'Swap service temporarily unavailable. Please try again.';
  }

  return message;
}

export interface SwapWidgetProps {
  chainId: number;
  targetToken: {
    address: string;
    symbol: string;
    decimals: number;
    logoUrl?: string;
  };
  targetAmount: bigint;
  onClose: (reason: 'success' | 'cancelled' | 'error') => void;
  onBalanceUpdate?: (token: { address: string }, balance: bigint) => void;
  onSwapSuccess?: () => void;
}

/**
 * ParaSwap-based swap widget for acquiring tokens
 *
 * Features:
 * - Fixed target token and amount (output)
 * - Source token selection from ParaSwap token list
 * - Real-time quote with expiration countdown
 * - Configurable slippage (presets + custom)
 * - Token approval flow
 * - Auto-close on success
 */
export function SwapWidget({
  chainId,
  targetToken,
  targetAmount,
  onClose,
  onBalanceUpdate: _onBalanceUpdate,
  onSwapSuccess,
}: SwapWidgetProps) {
  const { address: userAddress } = useAccount();

  // State
  const [sourceToken, setSourceToken] = useState<SwapToken | null>(null);
  const [slippageBps, setSlippageBps] = useState(50); // 0.5% default

  // Check if chain is supported
  const isChainSupported = isParaswapSupportedChain(chainId);

  // Get chain slug for token search
  const chainSlug = getChainSlugByChainId(chainId);

  // Get quote using BUY side (fixed output amount)
  // We want to buy targetAmount of targetToken, ParaSwap calculates how much srcToken we need
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
    destToken: targetToken.address,
    destDecimals: targetToken.decimals,
    amount: targetAmount.toString(), // Amount of destToken we want to receive
    userAddress: userAddress,
    side: 'BUY', // Fixed output amount
    slippageBps,
    enabled: !!sourceToken && !!userAddress,
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

  // Source token balance (for insufficient balance check)
  const {
    balanceBigInt: sourceTokenBalance,
    isLoading: isLoadingSourceBalance,
  } = useErc20TokenBalance({
    chainId,
    tokenAddress: sourceToken?.address ?? null,
    walletAddress: userAddress ?? null,
    enabled: !!sourceToken && !!userAddress,
  });

  // Check if user has sufficient balance for the swap
  // Note: Use explicit undefined check since 0n is falsy
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
    reset: _resetSwap,
  } = useExecuteSwap({
    chainId,
    userAddress: userAddress as Address | undefined,
  });

  // Handle successful swap
  useEffect(() => {
    if (isSuccess) {
      onSwapSuccess?.();
      // Small delay before closing to show success state
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

  // Unsupported chain message
  if (!isChainSupported) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Swap</h3>
          <button
            onClick={() => onClose('cancelled')}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="text-center py-8">
          <p className="text-slate-300 mb-2">Swaps not available on this chain</p>
          <p className="text-slate-500 text-sm">
            Supported chains: Ethereum, Arbitrum, Base, Optimism
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">
          Swap to {targetToken.symbol}
        </h3>
        <button
          onClick={() => onClose('cancelled')}
          className="text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Target Token Display (Fixed Output) */}
      <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
        <div className="text-sm text-slate-400 mb-1">You'll receive (target)</div>
        <div className="flex items-center gap-3">
          {targetToken.logoUrl && (
            <img
              src={targetToken.logoUrl}
              alt={targetToken.symbol}
              className="w-8 h-8 rounded-full"
            />
          )}
          <div>
            <div className="text-xl font-semibold text-white">
              {formatCompactValue(targetAmount, targetToken.decimals)} {targetToken.symbol}
            </div>
          </div>
        </div>
      </div>

      {/* Source Token Selector */}
      {chainSlug && (
        <SourceTokenSelector
          chain={chainSlug}
          selectedToken={sourceToken}
          onSelect={setSourceToken}
          excludeAddresses={[targetToken.address]}
        />
      )}

      {/* Quote Display */}
      {sourceToken && (
        <QuoteDisplay
          quote={quote}
          isLoading={isLoadingQuote || isFetchingQuote}
          isExpired={isExpired}
          secondsUntilExpiry={secondsUntilExpiry}
          onRefresh={refreshQuote}
          sourceToken={sourceToken}
          destToken={targetToken}
        />
      )}

      {/* Slippage Settings */}
      <SlippageSettings
        slippageBps={slippageBps}
        onSlippageChange={setSlippageBps}
      />

      {/* Error Display */}
      {(approvalError || swapError) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
          <p className="text-red-400 text-sm">
            {parseSwapError(approvalError) || parseSwapError(swapError)}
          </p>
        </div>
      )}

      {/* Swap Button */}
      <SwapButton
        hasSourceToken={!!sourceToken}
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
