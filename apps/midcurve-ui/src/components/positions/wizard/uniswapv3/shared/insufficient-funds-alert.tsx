'use client';

import { useState } from 'react';
import { formatUnits } from 'viem';
import type { EvmChainSlug } from '@/config/chains';
import { formatCompactValue } from '@/lib/fraction-format';
import { CowSwapWidget } from '@/components/common/cow-swap-widget';

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
 * Displays insufficient funds warning with embedded CowSwap widget
 *
 * Shows different messages depending on which tokens are insufficient:
 * 1. Only base token - "buy X BASE (swap here)"
 * 2. Only quote token - "buy X QUOTE (swap here)"
 * 3. Both tokens - "buy X BASE (swap here) and Y QUOTE (swap here)"
 *
 * Clicking "(swap here)" opens the CowSwap widget inline with the missing amount pre-filled.
 * The widget closes automatically when the user completes the swap and their balance updates.
 */
export function InsufficientFundsAlert({
  insufficientFunds,
  pool,
  baseTokenAddress,
  quoteTokenAddress,
  isConnected,
  chain,
}: InsufficientFundsAlertProps) {
  const [showCowSwapWidget, setShowCowSwapWidget] = useState(false);
  const [cowSwapBuyToken, setCowSwapBuyToken] = useState<
    | {
        address: string;
        symbol: string;
        decimals: number;
        amount: string;
      }
    | undefined
  >();

  const handleCowSwapClick = (tokenType: 'base' | 'quote') => {
    if (!pool) return;

    // Clear previous buy token state first
    // This ensures the widget re-renders properly with new token
    setCowSwapBuyToken(undefined);

    // Use setTimeout to ensure state is cleared before setting new value
    setTimeout(() => {
      if (tokenType === 'base' && insufficientFunds.needsBase) {
        const baseTokenData =
          pool.token0.address.toLowerCase() === baseTokenAddress?.toLowerCase()
            ? pool.token0
            : pool.token1;

        setCowSwapBuyToken({
          address: baseTokenData.address,
          symbol: baseTokenData.symbol,
          decimals: baseTokenData.decimals,
          amount: formatUnits(
            insufficientFunds.missingBase,
            baseTokenData.decimals
          ),
        });
      } else if (tokenType === 'quote' && insufficientFunds.needsQuote) {
        const quoteTokenData =
          pool.token0.address.toLowerCase() === quoteTokenAddress?.toLowerCase()
            ? pool.token0
            : pool.token1;

        setCowSwapBuyToken({
          address: quoteTokenData.address,
          symbol: quoteTokenData.symbol,
          decimals: quoteTokenData.decimals,
          amount: formatUnits(
            insufficientFunds.missingQuote,
            quoteTokenData.decimals
          ),
        });
      }

      setShowCowSwapWidget(true);
    }, 10);
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
            <button
              onClick={() => handleCowSwapClick('base')}
              disabled={!isConnected}
              className="text-amber-400 hover:text-amber-300 underline decoration-dashed decoration-amber-400 hover:decoration-amber-300 underline-offset-2 transition-colors disabled:text-slate-400 disabled:decoration-slate-400 cursor-pointer disabled:cursor-not-allowed"
            >
              (swap here)
            </button>{' '}
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
            <button
              onClick={() => handleCowSwapClick('quote')}
              disabled={!isConnected}
              className="text-amber-400 hover:text-amber-300 underline decoration-dashed decoration-amber-400 hover:decoration-amber-300 underline-offset-2 transition-colors disabled:text-slate-400 disabled:decoration-slate-400 cursor-pointer disabled:cursor-not-allowed"
            >
              (swap here)
            </button>{' '}
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
            <button
              onClick={() => handleCowSwapClick('base')}
              disabled={!isConnected}
              className="text-amber-400 hover:text-amber-300 underline decoration-dashed decoration-amber-400 hover:decoration-amber-300 underline-offset-2 transition-colors disabled:text-slate-400 disabled:decoration-slate-400 cursor-pointer disabled:cursor-not-allowed"
            >
              (swap here)
            </button>{' '}
            and{' '}
            <span className="font-bold">
              {formatCompactValue(
                insufficientFunds.missingQuote,
                quoteTokenData.decimals
              )}{' '}
              {quoteTokenData.symbol}
            </span>{' '}
            <button
              onClick={() => handleCowSwapClick('quote')}
              disabled={!isConnected}
              className="text-amber-400 hover:text-amber-300 underline decoration-dashed decoration-amber-400 hover:decoration-amber-300 underline-offset-2 transition-colors disabled:text-slate-400 disabled:decoration-slate-400 cursor-pointer disabled:cursor-not-allowed"
            >
              (swap here)
            </button>{' '}
            to match your planned position size.
          </span>
        )}
      </div>

      {/* CowSwap Widget */}
      {showCowSwapWidget && cowSwapBuyToken && (
        <div className="mt-4 border-t border-slate-700/50 pt-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">
              Buy {cowSwapBuyToken.symbol}
            </h4>
            <button
              onClick={() => setShowCowSwapWidget(false)}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
          <CowSwapWidget buyToken={cowSwapBuyToken} chain={chain} />
        </div>
      )}
    </div>
  );
}
