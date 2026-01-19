'use client';

import { useState } from 'react';
import { isParaswapSupportedChain } from '@midcurve/api-shared';
import type { EvmChainSlug } from '@/config/chains';
import { getChainId } from '@/config/chains';
import { formatCompactValue } from '@/lib/fraction-format';
import { SwapWidget } from '@/components/swap';

export interface InsufficientFundsInfo {
  needsBase: boolean;
  needsQuote: boolean;
  missingBase: bigint;
  missingQuote: bigint;
}

interface PoolData {
  token0: {
    address: string;
    symbol: string;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    decimals: number;
  };
}

interface InsufficientFundsAlertProps {
  insufficientFunds: InsufficientFundsInfo;
  pool: PoolData;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  isConnected: boolean;
  chain: EvmChainSlug;
}

/**
 * Displays insufficient funds warning with embedded SwapWidget
 *
 * Shows different messages depending on which tokens are insufficient:
 * 1. Only base token - "buy X BASE (swap here)"
 * 2. Only quote token - "buy X QUOTE (swap here)"
 * 3. Both tokens - "buy X BASE (swap here) and Y QUOTE (swap here)"
 *
 * Clicking "(swap here)" opens the SwapWidget inline with the missing amount pre-filled.
 * The widget closes automatically when the user completes the swap.
 *
 * For unsupported chains (BSC, Polygon), shows a message that swaps are not available.
 */
export function InsufficientFundsAlert({
  insufficientFunds,
  pool,
  baseTokenAddress,
  quoteTokenAddress,
  isConnected,
  chain,
}: InsufficientFundsAlertProps) {
  const [showSwapWidget, setShowSwapWidget] = useState(false);
  const [swapTargetToken, setSwapTargetToken] = useState<{
    address: string;
    symbol: string;
    decimals: number;
    amount: bigint;
  } | null>(null);

  // Get chain ID from slug
  const chainId = getChainId(chain);

  // Check if chain is supported by ParaSwap
  const isSwapSupported = isParaswapSupportedChain(chainId);

  const handleSwapClick = (tokenType: 'base' | 'quote') => {
    if (!pool) return;

    // Clear previous state first
    setSwapTargetToken(null);

    // Use setTimeout to ensure state is cleared before setting new value
    setTimeout(() => {
      if (tokenType === 'base' && insufficientFunds.needsBase) {
        const baseTokenData =
          pool.token0.address.toLowerCase() === baseTokenAddress?.toLowerCase()
            ? pool.token0
            : pool.token1;

        setSwapTargetToken({
          address: baseTokenData.address,
          symbol: baseTokenData.symbol,
          decimals: baseTokenData.decimals,
          amount: insufficientFunds.missingBase,
        });
      } else if (tokenType === 'quote' && insufficientFunds.needsQuote) {
        const quoteTokenData =
          pool.token0.address.toLowerCase() === quoteTokenAddress?.toLowerCase()
            ? pool.token0
            : pool.token1;

        setSwapTargetToken({
          address: quoteTokenData.address,
          symbol: quoteTokenData.symbol,
          decimals: quoteTokenData.decimals,
          amount: insufficientFunds.missingQuote,
        });
      }

      setShowSwapWidget(true);
    }, 10);
  };

  const handleSwapClose = (_reason: 'success' | 'cancelled' | 'error') => {
    setShowSwapWidget(false);
    setSwapTargetToken(null);
  };

  // Get token data for display
  const baseTokenData =
    pool.token0.address.toLowerCase() === baseTokenAddress.toLowerCase()
      ? pool.token0
      : pool.token1;

  const quoteTokenData =
    pool.token0.address.toLowerCase() === quoteTokenAddress.toLowerCase()
      ? pool.token0
      : pool.token1;

  // Render swap link or nothing based on chain support
  const renderSwapAction = (tokenType: 'base' | 'quote') => {
    if (!isSwapSupported) {
      return null;
    }

    return (
      <button
        onClick={() => handleSwapClick(tokenType)}
        disabled={!isConnected}
        className="text-amber-400 hover:text-amber-300 underline decoration-dashed decoration-amber-400 hover:decoration-amber-300 underline-offset-2 transition-colors disabled:text-slate-400 disabled:decoration-slate-400 cursor-pointer disabled:cursor-not-allowed"
      >
        (swap here)
      </button>
    );
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
      <div className="text-slate-200 text-sm mb-4">
        {/* Case 1: Only base token insufficient */}
        {insufficientFunds.needsBase && !insufficientFunds.needsQuote && (
          <span>
            You need to{' '}
            <span className="font-bold">
              buy{' '}
              {formatCompactValue(
                insufficientFunds.missingBase,
                baseTokenData.decimals
              )}{' '}
              {baseTokenData.symbol}
            </span>{' '}
            {renderSwapAction('base')}{' '}
            to match your planned position size.
          </span>
        )}

        {/* Case 2: Only quote token insufficient */}
        {!insufficientFunds.needsBase && insufficientFunds.needsQuote && (
          <span>
            You need to{' '}
            <span className="font-bold">
              buy{' '}
              {formatCompactValue(
                insufficientFunds.missingQuote,
                quoteTokenData.decimals
              )}{' '}
              {quoteTokenData.symbol}
            </span>{' '}
            {renderSwapAction('quote')}{' '}
            to match your planned position size.
          </span>
        )}

        {/* Case 3: Both tokens insufficient */}
        {insufficientFunds.needsBase && insufficientFunds.needsQuote && (
          <span>
            You need to buy{' '}
            <span className="font-bold">
              {formatCompactValue(
                insufficientFunds.missingBase,
                baseTokenData.decimals
              )}{' '}
              {baseTokenData.symbol}
            </span>{' '}
            {renderSwapAction('base')}{' '}
            and{' '}
            <span className="font-bold">
              {formatCompactValue(
                insufficientFunds.missingQuote,
                quoteTokenData.decimals
              )}{' '}
              {quoteTokenData.symbol}
            </span>{' '}
            {renderSwapAction('quote')}{' '}
            to match your planned position size.
          </span>
        )}

        {/* Info message for unsupported chains */}
        {!isSwapSupported && (
          <div className="mt-2 text-slate-400 text-xs">
            Swaps not available on this chain. Please swap tokens externally.
          </div>
        )}
      </div>

      {/* SwapWidget */}
      {showSwapWidget && swapTargetToken && isSwapSupported && (
        <div className="mt-4 border-t border-slate-700/50 pt-4">
          <SwapWidget
            chainId={chainId}
            targetToken={{
              address: swapTargetToken.address,
              symbol: swapTargetToken.symbol,
              decimals: swapTargetToken.decimals,
            }}
            targetAmount={swapTargetToken.amount}
            onClose={handleSwapClose}
          />
        </div>
      )}
    </div>
  );
}
