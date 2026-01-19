/**
 * Quote Display Component
 *
 * Shows swap quote details including exchange rate, price impact,
 * gas costs, and expiration countdown.
 */

'use client';

import type { SwapQuoteData, SwapToken } from '@midcurve/api-shared';

import { formatCompactValue } from '@/lib/fraction-format';

interface QuoteDisplayProps {
  quote: SwapQuoteData | null;
  isLoading: boolean;
  isExpired: boolean;
  secondsUntilExpiry: number | null;
  onRefresh: () => void;
  sourceToken: SwapToken;
  destToken: {
    address: string;
    symbol: string;
    decimals: number;
    logoUrl?: string;
  };
}

/**
 * Displays quote details with expiration countdown
 */
export function QuoteDisplay({
  quote,
  isLoading,
  isExpired,
  secondsUntilExpiry,
  onRefresh,
  sourceToken,
  destToken,
}: QuoteDisplayProps) {
  if (!quote && !isLoading) return null;

  // Calculate exchange rate as bigint with 18 decimal precision
  // This represents "how much source token per 1 destination token"
  // Formula: (srcAmount / 10^srcDecimals) / (destAmount / 10^destDecimals) * 10^18
  //        = srcAmount * 10^destDecimals * 10^18 / (destAmount * 10^srcDecimals)
  const RATE_PRECISION = 18;
  const exchangeRateValue = quote
    ? (BigInt(quote.srcAmount) *
        10n ** BigInt(destToken.decimals) *
        10n ** BigInt(RATE_PRECISION)) /
      (BigInt(quote.destAmount) * 10n ** BigInt(sourceToken.decimals))
    : null;

  // Format price impact
  const priceImpactPercent = quote ? (quote.priceImpact * 100).toFixed(2) : null;
  const isPriceImpactHigh = quote && quote.priceImpact > 0.03; // > 3%
  const isPriceImpactMedium = quote && quote.priceImpact > 0.01; // > 1%

  // Format gas cost
  const gasCostUSD = quote ? parseFloat(quote.gasCostUSD).toFixed(2) : null;

  // Loading state
  if (isLoading && !quote) {
    return (
      <div className="bg-slate-900/30 rounded-lg p-4 mb-4 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-3/4 mb-2" />
        <div className="h-4 bg-slate-700 rounded w-1/2" />
      </div>
    );
  }

  if (!quote) return null;

  return (
    <div className="bg-slate-900/30 rounded-lg p-4 mb-4">
      {/* Exchange Rate */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-slate-400">Exchange Rate</span>
        <span className="text-sm text-white">
          1 {destToken.symbol} ={' '}
          {exchangeRateValue ? formatCompactValue(exchangeRateValue, RATE_PRECISION) : '—'}{' '}
          {sourceToken.symbol}
        </span>
      </div>

      {/* You'll Pay */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-slate-400">You'll pay</span>
        <span className="text-sm text-white font-medium">
          {formatCompactValue(BigInt(quote.srcAmount), sourceToken.decimals)}{' '}
          {sourceToken.symbol}
        </span>
      </div>

      {/* Price Impact */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-slate-400">Price Impact</span>
        <span
          className={`text-sm font-medium ${
            isPriceImpactHigh
              ? 'text-red-400'
              : isPriceImpactMedium
              ? 'text-amber-400'
              : 'text-green-400'
          }`}
        >
          {priceImpactPercent}%
        </span>
      </div>

      {/* Gas Cost */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-slate-400">Estimated Gas</span>
        <span className="text-sm text-slate-300">${gasCostUSD}</span>
      </div>

      {/* Minimum Received */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-slate-400">Minimum Received</span>
        <span className="text-sm text-slate-300">
          {formatCompactValue(BigInt(quote.minDestAmount), destToken.decimals)}{' '}
          {destToken.symbol}
        </span>
      </div>

      {/* Expiration */}
      <div className="border-t border-slate-700/50 pt-3 mt-3">
        {isExpired ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-amber-400">Quote expired</span>
            <button
              onClick={onRefresh}
              className="text-sm text-amber-400 hover:text-amber-300 underline cursor-pointer"
            >
              Refresh Quote
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Quote expires in</span>
            <span
              className={`text-sm font-mono ${
                secondsUntilExpiry && secondsUntilExpiry < 30
                  ? 'text-amber-400'
                  : 'text-slate-300'
              }`}
            >
              {secondsUntilExpiry}s
            </span>
          </div>
        )}
      </div>

      {/* High Price Impact Warning */}
      {isPriceImpactHigh && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          Warning: High price impact. Consider swapping a smaller amount.
        </div>
      )}
    </div>
  );
}
