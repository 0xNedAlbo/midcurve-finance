/**
 * FreeFormSwapWidget Component
 *
 * Full-featured swap interface using Paraswap (Velora).
 * Supports both SELL (exact input) and BUY (exact output) modes.
 * Calls Paraswap API directly from the browser — no backend involvement.
 */

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { parseUnits, formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';
import { formatCompactValue } from '@midcurve/shared';
import { ArrowDownUp } from 'lucide-react';
import type { ParaswapSide } from '@/lib/paraswap-client';

import { useParaswapQuote, useSwapApproval, useParaswapExecuteSwap } from '@/hooks/swap';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';
import { getChainSlugByChainId } from '@/config/chains';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { SourceTokenSelector } from './source-token-selector';
import { TokenAmountInput } from './token-amount-input';
import { QuoteDisplay } from './quote-display';
import { SlippageSettings } from './slippage-settings';
import { SwapButton } from './swap-button';

function parseSwapError(error: Error | null): string | null {
  if (!error) return null;
  const message = error.message || '';

  // Try to extract Paraswap error from JSON
  const jsonMatch = message.match(/\{[^}]*"error"\s*:\s*"([^"]+)"[^}]*\}/);
  if (jsonMatch) return jsonMatch[1];

  if (message.includes('User rejected') || message.includes('user rejected')) {
    return 'Transaction rejected by user';
  }
  if (message.includes('insufficient funds')) {
    return 'Insufficient funds for transaction';
  }
  if (message.includes('EXTERNAL_SERVICE_ERROR') || message.includes('Failed to build swap')) {
    return 'Swap service temporarily unavailable. Please try again.';
  }

  return message;
}

export interface SwapPrefill {
  /** Pre-selected source (sell) token */
  sourceToken?: SwapToken;
  /** Pre-selected destination (buy) token */
  destToken?: SwapToken;
  /** Pre-filled amount in raw token units (e.g. "1500000" for 1.5 USDC) */
  amount?: string;
  /** Pre-selected swap direction */
  side?: ParaswapSide;
}

export interface FreeFormSwapWidgetProps {
  chainId: number;
  onClose: (reason: 'success' | 'cancelled' | 'error') => void;
  onSwapSuccess?: () => void;
  /** Optional prefill values for tokens, amount, and direction */
  prefill?: SwapPrefill;
}

export function FreeFormSwapWidget({
  chainId,
  onClose,
  onSwapSuccess,
  prefill,
}: FreeFormSwapWidgetProps) {
  const { address: userAddress, chain: walletChain } = useAccount();
  const isWrongNetwork = walletChain !== undefined && walletChain.id !== chainId;

  // State — initialized from prefill when provided
  const [sourceToken, setSourceToken] = useState<SwapToken | null>(prefill?.sourceToken ?? null);
  const [destToken, setDestToken] = useState<SwapToken | null>(prefill?.destToken ?? null);
  const [side, setSide] = useState<ParaswapSide>(prefill?.side ?? 'SELL');
  const [amount, setAmount] = useState<string>(() => {
    if (!prefill?.amount) return '';
    // Convert raw token amount to human-readable for the input field
    const relevantToken = (prefill.side ?? 'SELL') === 'SELL' ? prefill.sourceToken : prefill.destToken;
    if (!relevantToken) return '';
    return formatUnits(BigInt(prefill.amount), relevantToken.decimals);
  });
  const [slippageBps, setSlippageBps] = useState(50); // 0.5% default

  const chainSlug = getChainSlugByChainId(chainId);

  // Calculate amount in wei for the relevant token (source for SELL, dest for BUY)
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

  // Get quote from Paraswap
  const {
    quote,
    isLoading: isLoadingQuote,
    isFetching: isFetchingQuote,
    isExpired,
    secondsUntilExpiry,
    refreshQuote,
  } = useParaswapQuote({
    chainId,
    srcToken: sourceToken?.address,
    srcDecimals: sourceToken?.decimals,
    destToken: destToken?.address,
    destDecimals: destToken?.decimals,
    amount: amountInWei,
    userAddress,
    side,
    enabled: !!sourceToken && !!destToken && !!amountInWei && !!userAddress,
    autoRefresh: true,
  });

  // Token approval — spender is Paraswap's TokenTransferProxy
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
    spenderAddress: (quote?.tokenTransferProxy as Address) ?? null,
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
    return sourceTokenBalance < BigInt(quote.srcAmount);
  }, [quote, sourceTokenBalance]);

  // Execute swap
  const {
    executeSwap,
    isPreparing,
    isExecuting,
    isWaitingForConfirmation: isSwapConfirming,
    isSuccess,
    error: swapError,
  } = useParaswapExecuteSwap({
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

  const handleSwap = useCallback(() => {
    if (!quote) return;
    executeSwap({ quote, slippageBps });
  }, [quote, slippageBps, executeSwap]);

  // Flip tokens
  const handleFlipTokens = useCallback(() => {
    const temp = sourceToken;
    setSourceToken(destToken);
    setDestToken(temp);
    setSide((prev) => (prev === 'SELL' ? 'BUY' : 'SELL'));
    setAmount('');
  }, [sourceToken, destToken]);

  // MAX button
  const handleMaxClick = useCallback(() => {
    if (sourceTokenBalance !== undefined && sourceToken) {
      const balanceStr = formatUnits(sourceTokenBalance, sourceToken.decimals);
      setAmount(balanceStr);
      setSide('SELL');
    }
  }, [sourceTokenBalance, sourceToken]);

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
                <>Balance: {formatCompactValue(sourceTokenBalance, sourceToken.decimals)} {sourceToken.symbol}</>
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
                <>Balance: {formatCompactValue(destTokenBalance, destToken.decimals)} {destToken.symbol}</>
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
          onClick={() => { setSide('SELL'); setAmount(''); }}
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
          onClick={() => { setSide('BUY'); setAmount(''); }}
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
          isLoading={isLoadingQuote}
          isFetching={isFetchingQuote}
          isExpired={isExpired}
          secondsUntilExpiry={secondsUntilExpiry}
          onRefresh={refreshQuote}
          sourceToken={sourceToken}
          destToken={destToken}
          side={side}
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

      {/* Switch Network Prompt */}
      {chainSlug && (
        <EvmSwitchNetworkPrompt chain={chainSlug} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Swap Button */}
      <SwapButton
        hasSourceToken={!!sourceToken && !!destToken}
        hasQuote={!!quote}
        isExpired={isExpired}
        isWrongNetwork={isWrongNetwork}
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
