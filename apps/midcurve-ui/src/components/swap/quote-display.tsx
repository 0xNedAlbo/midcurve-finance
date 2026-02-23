/**
 * Quote Display Component
 *
 * Displays a Paraswap swap quote with rate, price impact, gas cost,
 * and expiration countdown.
 */

'use client';

import { formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';
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

function formatAmount(raw: string, decimals: number): string {
  const formatted = formatUnits(BigInt(raw), decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(6);
  if (num < 10000) return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

  const srcAmountDisplay = formatAmount(quote.srcAmount, sourceToken.decimals);
  const destAmountDisplay = formatAmount(quote.destAmount, destToken.decimals);

  // Calculate exchange rate
  const srcNum = parseFloat(formatUnits(BigInt(quote.srcAmount), sourceToken.decimals));
  const destNum = parseFloat(formatUnits(BigInt(quote.destAmount), destToken.decimals));
  const rate = srcNum > 0 ? (destNum / srcNum).toPrecision(6) : '0';

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
        <span className="text-sm text-slate-300">
          1 {sourceToken.symbol} = {rate} {destToken.symbol}
        </span>
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
