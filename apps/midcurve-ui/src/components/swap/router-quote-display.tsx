/**
 * Router Quote Display Component
 *
 * Shows swap quote details from MidcurveSwapRouter including:
 * - Hop route visualization
 * - Fair value price from CoinGecko
 * - Estimated output vs fair value
 * - Deviation analysis
 * - Min amount out
 */

'use client';

import { useState } from 'react';
import type { RouterSwapQuoteData, SwapToken } from '@midcurve/api-shared';
import { formatCompactValue } from '@/lib/fraction-format';

interface RouterQuoteDisplayProps {
  quote: RouterSwapQuoteData | null;
  isLoading: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  sourceToken: SwapToken;
  destToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Color class for deviation indicator
 */
function deviationColorClass(bps: number | null): string {
  if (bps === null) return 'text-slate-400';
  // Negative deviation = user gets more than fair value (favorable)
  if (bps < 0) return 'text-green-400';
  // Positive deviation = user gets less than fair value (unfavorable)
  if (bps <= 50) return 'text-green-400';   // <= 0.5%
  if (bps <= 200) return 'text-amber-400';  // <= 2%
  return 'text-red-400';                    // > 2%
}

/**
 * Displays MidcurveSwapRouter quote details
 */
export function RouterQuoteDisplay({
  quote,
  isLoading,
  isFetching,
  onRefresh,
  sourceToken,
  destToken,
}: RouterQuoteDisplayProps) {
  if (!quote && !isLoading) return null;

  // Loading state
  if (isLoading && !quote) {
    return (
      <div className="bg-slate-900/30 rounded-lg p-4 mb-4 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-3/4 mb-2" />
        <div className="h-4 bg-slate-700 rounded w-1/2 mb-2" />
        <div className="h-4 bg-slate-700 rounded w-2/3" />
      </div>
    );
  }

  if (!quote) return null;

  const isDoNotExecute = quote.kind === 'do_not_execute';
  const [routeExpanded, setRouteExpanded] = useState(false);

  return (
    <div className="bg-slate-900/30 rounded-lg p-4 mb-4">
      {/* Do Not Execute Warning */}
      {isDoNotExecute && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          Swap conditions unfavorable{quote.reason ? `: ${quote.reason}` : ''}
        </div>
      )}

      {/* Hop Route (Collapsible) */}
      {quote.hops.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setRouteExpanded(!routeExpanded)}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-300 cursor-pointer w-full"
          >
            <span className={`transition-transform text-xs ${routeExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
            <span>
              Routed through {quote.hops.length} {quote.hops.length === 1 ? 'Pool' : 'Pools'}
            </span>
          </button>
          {routeExpanded && (
            <div className="mt-2 ml-4 space-y-1.5">
              {quote.hops.map((hop, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-white font-medium">{hop.tokenInSymbol}</span>
                  <span className="text-slate-500">&rarr;</span>
                  <span className="text-slate-400 text-xs bg-slate-700/50 px-1.5 py-0.5 rounded">
                    {hop.venueName} {hop.feeTier > 0 ? `${(hop.feeTier / 10000).toFixed(2)}%` : ''}
                  </span>
                  <span className="text-slate-500">&rarr;</span>
                  <span className="text-white font-medium">{hop.tokenOutSymbol}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fair Value Price */}
      {quote.fairValuePrice !== null && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">Fair Value (CoinGecko)</span>
          <span className="text-sm text-slate-300">
            1 {sourceToken.symbol} = {quote.fairValuePrice.toFixed(6)} {destToken.symbol}
          </span>
        </div>
      )}

      {/* USD Prices */}
      {(quote.tokenInUsdPrice !== null || quote.tokenOutUsdPrice !== null) && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">USD Prices</span>
          <span className="text-xs text-slate-500">
            {quote.tokenInUsdPrice !== null && (
              <>{sourceToken.symbol}: ${quote.tokenInUsdPrice.toFixed(2)}</>
            )}
            {quote.tokenInUsdPrice !== null && quote.tokenOutUsdPrice !== null && ' | '}
            {quote.tokenOutUsdPrice !== null && (
              <>{destToken.symbol}: ${quote.tokenOutUsdPrice.toFixed(2)}</>
            )}
          </span>
        </div>
      )}

      {/* Estimated Output */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-slate-400">Estimated Output</span>
        <span className="text-sm text-white font-medium">
          {formatCompactValue(BigInt(quote.estimatedAmountOut), destToken.decimals)}{' '}
          {destToken.symbol}
        </span>
      </div>

      {/* Fair Value Output */}
      {quote.fairValueAmountOut !== '0' && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">Fair Value Output</span>
          <span className="text-sm text-slate-300">
            {formatCompactValue(BigInt(quote.fairValueAmountOut), destToken.decimals)}{' '}
            {destToken.symbol}
          </span>
        </div>
      )}

      {/* Deviation from Fair Value */}
      {quote.actualDeviationBps !== null && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">Deviation</span>
          <span className={`text-sm font-medium ${deviationColorClass(quote.actualDeviationBps)}`}>
            {quote.actualDeviationBps > 0 ? '-' : '+'}
            {(Math.abs(quote.actualDeviationBps) / 100).toFixed(2)}%
          </span>
        </div>
      )}

      {/* Min Amount Out */}
      {!isDoNotExecute && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">Min Amount Out</span>
          <span className="text-sm text-slate-300">
            {formatCompactValue(BigInt(quote.minAmountOut), destToken.decimals)}{' '}
            {destToken.symbol}
          </span>
        </div>
      )}

      {/* Diagnostics */}
      {quote.diagnostics && (
        <div className="border-t border-slate-700/50 pt-3 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {quote.diagnostics.poolsDiscovered} pools | {quote.diagnostics.pathsEnumerated} paths | {quote.diagnostics.pathsQuoted} quoted
            </span>
            {isFetching && (
              <span className="text-xs text-slate-500 animate-pulse">Updating...</span>
            )}
            {!isFetching && (
              <button
                onClick={onRefresh}
                className="text-xs text-slate-500 hover:text-slate-400 cursor-pointer"
              >
                Refresh
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
