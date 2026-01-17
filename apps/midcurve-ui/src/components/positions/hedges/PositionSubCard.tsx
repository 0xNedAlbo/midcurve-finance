/**
 * PositionSubCard - Compact position metrics for the expanded hedge section
 *
 * Displays the Uniswap V3 position's individual metrics without hedge aggregation.
 * Reuses UniswapV3MiniPnLCurve for the PnL curve visualization.
 */

'use client';

import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import type { ListPositionData } from '@midcurve/api-shared';
import { UniswapV3MiniPnLCurve } from '../protocol/uniswapv3/uniswapv3-mini-pnl-curve';

interface PositionSubCardProps {
  position: ListPositionData;
}

/**
 * Format a bigint value as a display string with the given decimals
 */
function formatBigIntValue(value: string, decimals: number): string {
  const bigValue = BigInt(value);
  const divisor = BigInt(10 ** decimals);
  const intPart = bigValue / divisor;
  const fracPart = bigValue % divisor;

  // Format with 2-3 decimal places
  const fracStr = fracPart.toString().padStart(decimals, '0').slice(0, 3);

  return `${intPart.toLocaleString('en-US')}.${fracStr}`;
}

/**
 * Check if position was opened recently (less than 5 minutes ago)
 */
function isRecentlyOpened(positionOpenedAt: string | null): boolean {
  if (!positionOpenedAt) return false;
  const openedTime = new Date(positionOpenedAt).getTime();
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  return now - openedTime < fiveMinutes;
}

export function PositionSubCard({ position }: PositionSubCardProps) {
  // Extract quote token for formatting
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Calculate total PnL (realized + unrealized + unclaimed fees + collected fees)
  const totalPnl =
    BigInt(position.realizedPnl) +
    BigInt(position.unrealizedPnl) +
    BigInt(position.unClaimedFees) +
    BigInt(position.collectedFees);

  const isProfit = totalPnl >= 0n;
  const hasUnclaimedFees = BigInt(position.unClaimedFees) > 0n;
  const showAprClock = isRecentlyOpened(position.positionOpenedAt);

  return (
    <div className="bg-slate-800/30 rounded-lg p-3">
      <div className="flex items-center gap-4 md:gap-6">
        {/* Current Value */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] md:text-xs text-slate-500">
            Current Value ({quoteToken.symbol})
          </span>
          <span className="text-sm md:text-base font-medium text-slate-100">
            {formatBigIntValue(position.currentValue, quoteToken.decimals)}
          </span>
        </div>

        {/* PnL Curve */}
        <div className="flex flex-col">
          <span className="text-[10px] md:text-xs text-slate-500">PnL Curve</span>
          <UniswapV3MiniPnLCurve position={position} />
        </div>

        {/* Total PnL */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] md:text-xs text-slate-500">
            Total PnL ({quoteToken.symbol})
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
            {formatBigIntValue(totalPnl.toString(), quoteToken.decimals)}
          </span>
        </div>

        {/* Unclaimed Fees */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] md:text-xs text-slate-500">
            Unclaimed Fees ({quoteToken.symbol})
          </span>
          <span
            className={`text-sm md:text-base font-medium ${
              hasUnclaimedFees ? 'text-amber-400' : 'text-slate-400'
            }`}
          >
            {formatBigIntValue(position.unClaimedFees, quoteToken.decimals)}
          </span>
        </div>

        {/* est. APR */}
        <div className="flex flex-col min-w-[60px]">
          <span className="text-[10px] md:text-xs text-slate-500">est. APR</span>
          {showAprClock ? (
            <span className="text-sm md:text-base font-medium text-slate-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              --
            </span>
          ) : (
            <span className="text-sm md:text-base font-medium text-slate-100">
              {position.totalApr !== null
                ? `${position.totalApr.toFixed(2)}%`
                : '--'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
