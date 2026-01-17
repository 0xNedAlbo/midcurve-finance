/**
 * HedgeListItem - Individual hedge display component
 *
 * Two-row layout:
 * - Row 1: Current Value, PnL Curve, Total PnL, Unrealized Funding, Funding APR
 * - Row 2: Coin badge, Size, Position Value, Entry Price, Mark Price, PNL%, Liq. Price, Margin, Funding
 */

'use client';

import { TrendingUp, TrendingDown, Pencil } from 'lucide-react';
import type { MockHedge } from './mock-hedge-data';
import { HedgeLinearPnlCurve } from './HedgeLinearPnlCurve';

interface HedgeListItemProps {
  hedge: MockHedge;
  quoteSymbol: string;
}

/**
 * Format a number for display with appropriate decimal places
 */
function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format price with comma separators
 */
function formatPrice(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function HedgeListItem({ hedge, quoteSymbol }: HedgeListItemProps) {
  const isProfit = hedge.totalPnlQuote >= 0;
  const isPnlUsdProfit = hedge.pnlUsd >= 0;

  return (
    <div className="bg-slate-800/30 rounded-lg p-3 mb-2 last:mb-0">
      {/* Row 1: Metrics */}
      <div className="flex items-center gap-4 md:gap-6">
        {/* Current Value */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] md:text-xs text-slate-500">
            Current Value ({quoteSymbol})
          </span>
          <span className="text-sm md:text-base font-medium text-slate-100">
            {formatNumber(hedge.currentValueQuote)}
          </span>
        </div>

        {/* PnL Curve */}
        <div className="flex flex-col">
          <span className="text-[10px] md:text-xs text-slate-500">PnL Curve</span>
          <HedgeLinearPnlCurve hedge={hedge} quoteSymbol={quoteSymbol} />
        </div>

        {/* Total PnL */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] md:text-xs text-slate-500">
            Total PnL ({quoteSymbol})
          </span>
          <span
            className={`text-sm md:text-base font-medium flex items-center gap-1 ${
              isProfit ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {isProfit ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {isProfit ? '+' : ''}
            {formatNumber(hedge.totalPnlQuote, 3)}
          </span>
        </div>

        {/* Unrealized Funding */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] md:text-xs text-slate-500">
            Funding ({quoteSymbol})
          </span>
          <span className="text-sm md:text-base font-medium text-amber-400">
            {formatNumber(hedge.unrealizedFunding, 3)}
          </span>
        </div>

        {/* Funding APR */}
        <div className="flex flex-col min-w-[60px]">
          <span className="text-[10px] md:text-xs text-slate-500">Funding APR</span>
          <span className="text-sm md:text-base font-medium text-slate-100">
            {formatNumber(hedge.fundingApr)}%
          </span>
        </div>
      </div>

      {/* Row 2: Details */}
      <div className="flex items-center gap-3 md:gap-4 mt-3 pt-3 border-t border-slate-700/30 flex-wrap">
        {/* Coin Badge with Leverage */}
        <div
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            hedge.direction === 'short'
              ? 'bg-red-900/30 text-red-300'
              : 'bg-green-900/30 text-green-300'
          }`}
        >
          {hedge.coin} {hedge.leverage}x
        </div>

        {/* Size */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500">Size</span>
          <span
            className={`text-xs ${
              hedge.direction === 'short' ? 'text-red-300' : 'text-green-300'
            }`}
          >
            {hedge.sizeFormatted}
          </span>
        </div>

        {/* Position Value */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500">Position Value</span>
          <span className="text-xs text-slate-300">
            {formatNumber(hedge.positionValueUsd)}
          </span>
        </div>

        {/* Entry Price */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500">Entry Price</span>
          <span className="text-xs text-slate-300">{formatPrice(hedge.entryPrice)}</span>
        </div>

        {/* Mark Price */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500">Mark Price</span>
          <span className="text-xs text-slate-300">{formatPrice(hedge.markPrice)}</span>
        </div>

        {/* PNL (ROE %) */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 underline decoration-dotted cursor-help">
            PNL (ROE %)
          </span>
          <span
            className={`text-xs ${
              isPnlUsdProfit ? 'text-green-300' : 'text-red-300'
            }`}
          >
            {isPnlUsdProfit ? '+' : ''}{formatNumber(hedge.pnlUsd)} ({isPnlUsdProfit ? '+' : ''}
            {formatNumber(hedge.pnlPercent, 1)}%)
          </span>
        </div>

        {/* Liq. Price */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500">Liq. Price</span>
          <span className="text-xs text-slate-300">{formatPrice(hedge.liquidationPrice)}</span>
        </div>

        {/* Margin */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 underline decoration-dotted cursor-help">
            Margin
          </span>
          <span className="text-xs text-slate-300 flex items-center gap-1">
            {formatNumber(hedge.margin)} ({hedge.marginMode === 'isolated' ? 'Isolated' : 'Cross'})
            <a href="#" className="cursor-pointer hover:text-slate-400 transition-colors">
              <Pencil className="w-3 h-3 text-slate-500" />
            </a>
          </span>
        </div>

        {/* Funding */}
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 underline decoration-dotted cursor-help">
            Funding
          </span>
          <span className="text-xs text-slate-300">
            -{formatNumber(Math.abs(hedge.unrealizedFunding))}
          </span>
        </div>

        {/* Action Buttons */}
        <button className="px-2 py-1 text-xs font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600/50 rounded transition-colors cursor-pointer">
          Adjust size
        </button>
        <button className="px-2 py-1 text-xs font-medium text-red-300 bg-red-900/20 hover:bg-red-800/30 border border-red-600/50 rounded transition-colors cursor-pointer">
          Close
        </button>
      </div>
    </div>
  );
}
