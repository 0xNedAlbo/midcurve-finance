/**
 * FreeFormSwapWidget Component
 *
 * Full-featured swap interface using Paraswap (Velora).
 * Supports both SELL (exact input) and BUY (exact output) modes.
 * Calls Paraswap API directly from the browser — no backend involvement.
 */

'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { parseUnits, formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';
import { formatCompactValue } from '@midcurve/shared';
import { ArrowDownUp } from 'lucide-react';
import type { ParaswapSide } from '@/lib/paraswap-client';

import { useParaswapQuote, useParaswapExecuteSwap } from '@/hooks/swap';
import { useWatchErc20TokenBalance } from '@/hooks/tokens/erc20/useWatchErc20TokenBalance';
import { getChainSlugByChainId } from '@/config/chains';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useErc20TokenApprovalPrompt } from '@/components/common/Erc20TokenApprovalPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { SourceTokenSelector } from './source-token-selector';
import { TokenAmountInput } from './token-amount-input';
import { QuoteDisplay } from './quote-display';
import { SlippageSettings } from './slippage-settings';

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

  // Track whether the user has completed approval — pause quote auto-refresh
  // once approved so rising prices don't invalidate the allowance.
  const [approvedOnce, setApprovedOnce] = useState(false);

  // Reset when swap inputs change
  useEffect(() => {
    setApprovedOnce(false);
  }, [amount, sourceToken, destToken, side]);

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
    autoRefresh: !approvedOnce,
  });

  // Execute swap — declared early so freshSrcAmount is available for approval
  const swap = useParaswapExecuteSwap({
    chainId,
    userAddress: userAddress as Address | undefined,
  });

  // Effective spender address — if /swap returned a different tokenTransferProxy,
  // use that so the approval targets the correct contract.
  const spenderAddress = useMemo(() => {
    return swap.freshSpender ?? quote?.tokenTransferProxy ?? null;
  }, [quote?.tokenTransferProxy, swap.freshSpender]);

  // Token approval via shared prompt
  // For BUY side, add slippage buffer since /swap may get a different srcAmount.
  // If /swap returned a higher srcAmount (freshSrcAmount), use that instead.
  const approvalAmount = useMemo(() => {
    if (!quote) return 0n;
    const quoteSrcAmount = BigInt(quote.srcAmount);
    const bufferedAmount = side === 'BUY'
      ? quoteSrcAmount * (10000n + BigInt(slippageBps)) / 10000n
      : quoteSrcAmount;
    // If the fresh /swap call returned a higher amount, use it (with buffer for BUY)
    if (swap.freshSrcAmount !== null) {
      const freshBuffered = side === 'BUY'
        ? swap.freshSrcAmount * (10000n + BigInt(slippageBps)) / 10000n
        : swap.freshSrcAmount;
      return bufferedAmount > freshBuffered ? bufferedAmount : freshBuffered;
    }
    return bufferedAmount;
  }, [quote, side, slippageBps, swap.freshSrcAmount]);

  const handleApprovalChange = useCallback((isApproved: boolean) => {
    if (isApproved) setApprovedOnce(true);
  }, []);

  const approvalPrompt = useErc20TokenApprovalPrompt({
    tokenAddress: (sourceToken?.address as Address) ?? null,
    tokenSymbol: sourceToken?.symbol ?? '',
    tokenDecimals: sourceToken?.decimals ?? 18,
    requiredAmount: approvalAmount,
    spenderAddress: (spenderAddress as Address) ?? null,
    chainId,
    enabled: !!sourceToken && !!quote && !!userAddress && !isWrongNetwork,
    onApprovalChange: handleApprovalChange,
  });

  // Source token balance
  const {
    balanceBigInt: sourceTokenBalance,
    isLoading: isLoadingSourceBalance,
  } = useWatchErc20TokenBalance({
    chainId,
    tokenAddress: sourceToken?.address ?? null,
    walletAddress: userAddress ?? null,
    enabled: !!sourceToken && !!userAddress,
  });

  // Destination token balance
  const {
    balanceBigInt: destTokenBalance,
    isLoading: isLoadingDestBalance,
  } = useWatchErc20TokenBalance({
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

  const handleSwap = useCallback(() => {
    if (!quote) return;
    swap.executeSwap({
      quote,
      slippageBps,
      currentAllowance: approvalPrompt.allowance,
      approvedSpender: (spenderAddress ?? undefined) as Address | undefined,
    });
  }, [quote, slippageBps, swap, approvalPrompt.allowance, spenderAddress]);

  // Swap transaction prompt
  const swapTx = useEvmTransactionPrompt({
    label: `Swap ${sourceToken?.symbol ?? ''} → ${destToken?.symbol ?? ''}`,
    buttonLabel: 'Swap',
    chainId,
    enabled: approvalPrompt.isApproved && !!quote && !isExpired,
    showActionButton: approvalPrompt.isApproved && !isExpired,
    txHash: swap.txHash,
    isSubmitting: swap.isPreparing || swap.isExecuting,
    error: swap.error,
    onExecute: handleSwap,
    onReset: swap.reset,
  });

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

  const handleFinish = useCallback(() => {
    onSwapSuccess?.();
    onClose('success');
  }, [onSwapSuccess, onClose]);

  const amountLabel = side === 'SELL' ? 'Amount to sell' : 'Amount to buy';
  const showSteps = !!quote && !insufficientBalance && !isWrongNetwork;

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

      {/* Side Toggle — hidden when direction is prefilled */}
      {!prefill?.side && (
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
      )}

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

      {/* Insufficient Balance */}
      {insufficientBalance && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 text-sm">
            Insufficient {sourceToken?.symbol} balance
          </p>
        </div>
      )}

      {/* Switch Network Prompt */}
      {chainSlug && (
        <EvmSwitchNetworkPrompt chain={chainSlug} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Steps — shown once quote is ready and conditions are met */}
      {showSteps && (
        <div className="space-y-2">
          {approvalPrompt.element}
          {swapTx.element}
        </div>
      )}

      {/* Finish button — only when swap is done */}
      {swapTx.isSuccess && (
        <button
          onClick={handleFinish}
          className="w-full py-3 px-4 rounded-lg font-semibold bg-green-500 hover:bg-green-600 text-white transition-colors cursor-pointer"
        >
          Finish
        </button>
      )}
    </div>
  );
}
