/**
 * StrategyCardMetrics - Aggregated metrics display for strategy
 */

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StrategyCardMetricsProps {
  currentValue: string;
  currentCostBasis: string;
  realizedCapitalGain: string;
  realizedIncome: string;
  unrealizedIncome: string;
  expenses: string;
  quoteToken?: {
    symbol: string;
    decimals: number;
  };
  positionCount: number;
}

export function StrategyCardMetrics({
  currentValue,
  currentCostBasis,
  realizedCapitalGain,
  realizedIncome,
  unrealizedIncome,
  expenses,
  quoteToken,
  positionCount,
}: StrategyCardMetricsProps) {
  // Parse bigint strings
  const value = BigInt(currentValue);
  const costBasis = BigInt(currentCostBasis);
  const realizedCap = BigInt(realizedCapitalGain);
  const realizedInc = BigInt(realizedIncome);
  const unrealizedInc = BigInt(unrealizedIncome);
  const exp = BigInt(expenses);

  // Calculate derived metrics
  const unrealizedCapitalGain = value - costBasis;
  const totalUnrealizedPnl = unrealizedCapitalGain + unrealizedInc;
  const totalRealizedPnl = realizedCap + realizedInc - exp;
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;

  // Format value with token decimals
  const decimals = quoteToken?.decimals ?? 6;
  const symbol = quoteToken?.symbol ?? "USD";

  const formatValue = (val: bigint): string => {
    const divisor = BigInt(10 ** decimals);
    const wholePart = val / divisor;
    const fractionalPart = val % divisor;

    // Handle negative values
    const isNegative = val < 0n;
    const absWhole = isNegative ? -wholePart : wholePart;
    const absFrac = isNegative ? -fractionalPart : fractionalPart;

    // Format with 2 decimal places for display
    const fracStr = absFrac.toString().padStart(decimals, "0").slice(0, 2);

    return `${isNegative ? "-" : ""}${absWhole.toLocaleString()}.${fracStr}`;
  };

  // Determine PnL trend
  const pnlTrend = totalPnl > 0n ? "positive" : totalPnl < 0n ? "negative" : "neutral";

  return (
    <div className="flex items-center gap-4 md:gap-6 lg:gap-8 flex-grow justify-center">
      {/* Current Value */}
      <div className="text-center">
        <div className="text-xs text-slate-400 mb-0.5">Value</div>
        <div className="text-sm md:text-base lg:text-lg font-semibold text-white">
          {formatValue(value)} {symbol}
        </div>
      </div>

      {/* Total PnL */}
      <div className="text-center">
        <div className="text-xs text-slate-400 mb-0.5">Total PnL</div>
        <div
          className={`flex items-center justify-center gap-1 text-sm md:text-base lg:text-lg font-semibold ${
            pnlTrend === "positive"
              ? "text-green-400"
              : pnlTrend === "negative"
              ? "text-red-400"
              : "text-slate-400"
          }`}
        >
          {pnlTrend === "positive" ? (
            <TrendingUp className="w-3.5 h-3.5 md:w-4 md:h-4" />
          ) : pnlTrend === "negative" ? (
            <TrendingDown className="w-3.5 h-3.5 md:w-4 md:h-4" />
          ) : (
            <Minus className="w-3.5 h-3.5 md:w-4 md:h-4" />
          )}
          <span>
            {totalPnl >= 0n ? "+" : ""}
            {formatValue(totalPnl)} {symbol}
          </span>
        </div>
      </div>

      {/* Position Count */}
      <div className="text-center">
        <div className="text-xs text-slate-400 mb-0.5">Positions</div>
        <div className="text-sm md:text-base lg:text-lg font-semibold text-white">
          {positionCount}
        </div>
      </div>
    </div>
  );
}
