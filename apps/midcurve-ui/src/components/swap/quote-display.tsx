/**
 * Quote Display Component
 *
 * Displays a Paraswap swap quote with rate, price impact, gas cost,
 * and expiration countdown.
 */

'use client';

import { useState } from 'react';
import { formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';
import { formatCompactValue } from '@midcurve/shared';
import type { ParaswapQuoteResult, ParaswapSide } from '@/lib/paraswap-client';

interface QuoteDisplayProps {
  quote: ParaswapQuoteResult | null;
  isLoading: boolean;
  isFetching: boolean;
  isExpired: boolean;
  secondsUntilExpiry: number | null;
  onRefresh: () => void;
  sourceToken: SwapToken;
  destToken: SwapToken;
  side: ParaswapSide;
}

export function QuoteDisplay({
  quote,
  isLoading,
  isFetching,
  isExpired,
  secondsUntilExpiry,
  onRefresh,
  sourceToken,
  destToken,
  side,
}: QuoteDisplayProps) {
  const [rateInverted, setRateInverted] = useState(false);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-slate-900/30 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-400">Fetching quote...</span>
        </div>
      </div>
    );
  }

  if (!quote) return null;

  const srcAmountDisplay = formatCompactValue(BigInt(quote.srcAmount), sourceToken.decimals);
  const destAmountDisplay = formatCompactValue(BigInt(quote.destAmount), destToken.decimals);

  // Calculate exchange rate
  const srcNum = parseFloat(formatUnits(BigInt(quote.srcAmount), sourceToken.decimals));
  const destNum = parseFloat(formatUnits(BigInt(quote.destAmount), destToken.decimals));
  const forwardRate = srcNum > 0 ? (destNum / srcNum).toPrecision(6) : '0';
  const inverseRate = destNum > 0 ? (srcNum / destNum).toPrecision(6) : '0';

  const priceImpactPercent = (quote.priceImpact * 100).toFixed(2);
  const isHighImpact = Math.abs(quote.priceImpact) > 0.03;

  return (
    <div className="bg-slate-900/30 rounded-lg p-4 space-y-3">
      {/* Estimated output / input */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {side === 'SELL' ? 'Estimated output' : 'Estimated cost'}
        </span>
        <span className={`text-sm font-medium ${isFetching ? 'text-slate-500 animate-pulse' : 'text-white'}`}>
          {side === 'SELL'
            ? `${destAmountDisplay} ${destToken.symbol}`
            : `${srcAmountDisplay} ${sourceToken.symbol}`}
        </span>
      </div>

      {/* Exchange rate */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">Rate</span>
        <button
          onClick={() => setRateInverted((prev) => !prev)}
          className="text-sm text-slate-300 hover:text-white cursor-pointer flex items-center gap-1"
        >
          {rateInverted
            ? `1 ${destToken.symbol} = ${inverseRate} ${sourceToken.symbol}`
            : `1 ${sourceToken.symbol} = ${forwardRate} ${destToken.symbol}`}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-slate-500">
            <path fillRule="evenodd" d="M13.78 10.47a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 1 1 1.06-1.06l.97.97V5.75a.75.75 0 0 1 1.5 0v5.69l.97-.97a.75.75 0 0 1 1.06 0ZM2.22 5.53a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1-1.06 1.06l-.97-.97v5.69a.75.75 0 0 1-1.5 0V4.56l-.97.97a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Price impact */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">Price impact</span>
        <span className={`text-sm ${isHighImpact ? 'text-red-400' : 'text-slate-300'}`}>
          {priceImpactPercent}%
        </span>
      </div>

      {/* Gas cost */}
      {quote.gasCostUSD && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Gas cost</span>
          <span className="text-sm text-slate-300">${parseFloat(quote.gasCostUSD).toFixed(2)}</span>
        </div>
      )}

      {/* Expiration */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
        {isExpired ? (
          <>
            <span className="text-sm text-amber-400">Quote expired</span>
            <button
              onClick={onRefresh}
              className="text-sm text-amber-400 hover:text-amber-300 underline cursor-pointer"
            >
              Refresh
            </button>
          </>
        ) : secondsUntilExpiry !== null ? (
          <>
            <span className="text-xs text-slate-500">
              Expires in {Math.floor(secondsUntilExpiry / 60)}:{(secondsUntilExpiry % 60).toString().padStart(2, '0')}
            </span>
            {isFetching && (
              <span className="text-xs text-slate-500">Updating...</span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
