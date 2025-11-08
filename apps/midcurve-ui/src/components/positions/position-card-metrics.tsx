/**
 * PositionCardMetrics - Protocol-agnostic metrics display
 *
 * Displays position value, PnL, unclaimed fees, and APR.
 * Works for all protocols (Uniswap V3, Orca, etc.)
 */

import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import { formatCurrency, formatPnL, formatPercentage, calculateAPR } from "@/lib/format-helpers";

interface Token {
  symbol: string;
  decimals: number;
}

interface PositionCardMetricsProps {
  currentValue: string; // BigInt as string (quote token units)
  realizedPnl: string; // BigInt as string (quote token units)
  unrealizedPnl: string; // BigInt as string (quote token units)
  unClaimedFees: string; // BigInt as string (quote token units)
  collectedFees: string; // BigInt as string (quote token units)
  currentCostBasis: string; // BigInt as string (quote token units)
  lastFeesCollectedAt: string | null; // ISO timestamp or null
  positionOpenedAt: string; // ISO timestamp
  quoteToken: Token;
  isActive: boolean; // Used for visual cues
  isInRange: boolean; // Used for APR calculation
  pnlCurveSlot?: React.ReactNode; // Protocol-specific PnL curve visualization
}

export function PositionCardMetrics({
  currentValue,
  realizedPnl,
  unrealizedPnl,
  unClaimedFees,
  collectedFees,
  currentCostBasis,
  lastFeesCollectedAt,
  positionOpenedAt,
  quoteToken,
  isActive: _isActive, // Reserved for future visual cues
  isInRange,
  pnlCurveSlot,
}: PositionCardMetricsProps) {
  // Calculate total PnL: realizedPnl + unrealizedPnl + unclaimedFees + collectedFees
  // Add error handling for malformed BigInt strings
  let totalPnl: string;
  try {
    const realized = BigInt(realizedPnl || '0');
    const unrealized = BigInt(unrealizedPnl || '0');
    const unclaimed = BigInt(unClaimedFees || '0');
    const collected = BigInt(collectedFees || '0');
    totalPnl = (realized + unrealized + unclaimed + collected).toString();
  } catch (error) {
    console.error('Error calculating total PnL:', {
      realizedPnl,
      unrealizedPnl,
      unClaimedFees,
      collectedFees,
      error,
    });
    totalPnl = '0';
  }

  // Format display values
  const formattedValue = formatCurrency(currentValue, quoteToken.decimals);
  const pnlFormatted = formatPnL(totalPnl, quoteToken.decimals);
  const formattedFees = formatCurrency(unClaimedFees, quoteToken.decimals);

  // Calculate APR
  const { apr, belowThreshold } = calculateAPR({
    costBasis: currentCostBasis,
    unClaimedFees,
    lastFeesCollectedAt,
    positionOpenedAt,
    isInRange,
    decimals: quoteToken.decimals,
  });

  const pnlBigInt = BigInt(totalPnl);

  return (
    <div className="flex items-center gap-1 md:gap-2 lg:gap-3 xl:gap-4">
      {/* Current Value */}
      <div className="text-right min-w-[80px] md:min-w-[100px] lg:min-w-[120px]">
        <div className="text-[10px] md:text-xs text-slate-400 mb-1">
          Current Value ({quoteToken.symbol})
        </div>
        <div className="text-sm md:text-base font-semibold text-white">
          {formattedValue}
        </div>
      </div>

      {/* PnL Curve Visualization */}
      <div className="text-right">
        <div className="text-[10px] md:text-xs text-slate-400 mb-1">PnL Curve</div>
        <div className="flex justify-end">
          {pnlCurveSlot || (
            <div className="w-[80px] h-[40px] md:w-[100px] md:h-[50px] lg:w-[120px] lg:h-[60px] bg-slate-700/30 rounded border border-slate-600/50 flex items-center justify-center">
              <span className="text-[10px] md:text-xs text-slate-500">N/A</span>
            </div>
          )}
        </div>
      </div>

      {/* Total PnL */}
      <div className="text-right min-w-[80px] md:min-w-[100px] lg:min-w-[120px]">
        <div className="text-[10px] md:text-xs text-slate-400 mb-1">
          Total PnL ({quoteToken.symbol})
        </div>
        <div className={`text-sm md:text-base font-semibold ${pnlFormatted.colorClass}`}>
          <div className="flex items-center justify-end gap-1">
            {pnlBigInt > 0n ? (
              <TrendingUp className="w-3 h-3" />
            ) : pnlBigInt < 0n ? (
              <TrendingDown className="w-3 h-3" />
            ) : null}
            <span>{pnlFormatted.text}</span>
          </div>
        </div>
      </div>

      {/* Unclaimed Fees */}
      <div className="text-right min-w-[70px] md:min-w-[90px] lg:min-w-[100px]">
        <div className="text-[10px] md:text-xs text-slate-400 mb-1">
          Unclaimed Fees ({quoteToken.symbol})
        </div>
        <div className={`text-sm md:text-base font-semibold ${
          BigInt(unClaimedFees) > 0n ? "text-amber-400" : "text-white"
        }`}>
          {formattedFees}
        </div>
      </div>

      {/* APR */}
      <div className="text-right min-w-[60px] md:min-w-[70px] lg:min-w-[80px]">
        <div className="text-[10px] md:text-xs text-slate-400 mb-1">est. APR</div>
        <div className="text-sm md:text-base font-semibold">
          {belowThreshold ? (
            <div className="flex items-center justify-end gap-1 text-slate-500" title="APR calculation requires at least 5 minutes of position history">
              <span>-</span>
              <Clock className="w-3 h-3" />
            </div>
          ) : (
            <span className="text-white">{formatPercentage(apr, 2)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
