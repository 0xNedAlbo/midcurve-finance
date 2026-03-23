"use client";

import type { OptionalitySummary as OptionalitySummaryType } from "@/hooks/positions/uniswapv3/useUniswapV3OptionalitySummary";
import { formatCompactValue } from "@/lib/fraction-format";

interface OptionalitySummaryProps {
  summary: OptionalitySummaryType | null;
  isLoading?: boolean;
}

export function OptionalitySummary({
  summary,
  isLoading,
}: OptionalitySummaryProps) {
  if (isLoading || !summary) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-700 rounded w-2/3"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-slate-700/30 rounded"></div>
            <div className="h-24 bg-slate-700/30 rounded"></div>
          </div>
          <div className="h-24 bg-slate-700/30 rounded"></div>
        </div>
      </div>
    );
  }

  const {
    baseTokenSymbol,
    quoteTokenSymbol,
    baseTokenDecimals,
    quoteTokenDecimals,
    totalPremium,
    netRebalancingBase,
    netRebalancingQuote,
    netRebalancingAvgPrice,
    netDepositBase,
    netDepositQuote,
    netDepositAvgPrice,
    withdrawnBase,
    withdrawnQuote,
    currentBase,
    currentQuote,
    currentSpotPrice,
    isClosed,
    daysActive,
  } = summary;

  const netBase = netRebalancingBase;
  const netQuote = netRebalancingQuote;
  const daysLabel = daysActive !== null ? `after ${daysActive} ${daysActive === 1 ? "day" : "days"}` : "now";

  // Build single narrative line from net rebalancing
  let narrative: string;
  if (netBase < 0n) {
    narrative = `The position sold ${formatCompactValue(-netBase, baseTokenDecimals)} ${baseTokenSymbol} at an average price of ${formatCompactValue(netRebalancingAvgPrice, quoteTokenDecimals)} ${quoteTokenSymbol}, earning ${formatCompactValue(totalPremium, quoteTokenDecimals)} ${quoteTokenSymbol} in fees.`;
  } else if (netBase > 0n) {
    narrative = `The position bought ${formatCompactValue(netBase, baseTokenDecimals)} ${baseTokenSymbol} at an average price of ${formatCompactValue(netRebalancingAvgPrice, quoteTokenDecimals)} ${quoteTokenSymbol}, earning ${formatCompactValue(totalPremium, quoteTokenDecimals)} ${quoteTokenSymbol} in fees.`;
  } else {
    narrative = "No rebalancing has occurred yet.";
  }

  // Direction label and color
  const direction = netBase < 0n ? "Sold" : netBase > 0n ? "Bought" : null;
  const directionColor = netBase < 0n ? "text-red-400" : "text-green-400";
  const absNetBase = netBase < 0n ? -netBase : netBase;
  const absNetQuote = netQuote < 0n ? -netQuote : netQuote;

  return (
    <div className="space-y-4">
      {/* Narrative line */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
        <p className="text-slate-300 text-sm leading-relaxed">{narrative}</p>
      </div>

      {/* Box A + B + C + D */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Box A: Deposits */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-sm font-semibold text-slate-400 mb-3">Deposits</h4>
          <div className="space-y-1.5">
            <div>
              <span className="text-white text-lg font-semibold">
                {formatCompactValue(netDepositBase, baseTokenDecimals)} {baseTokenSymbol}
              </span>
              {netDepositAvgPrice > 0n && (
                <span className="text-slate-500 text-lg ml-1">
                  @ {formatCompactValue(netDepositAvgPrice, quoteTokenDecimals)} {quoteTokenSymbol}
                </span>
              )}
            </div>
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(netDepositQuote, quoteTokenDecimals)} {quoteTokenSymbol}
            </div>
          </div>
        </div>

        {/* Box B: Already Withdrawn */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-sm font-semibold text-slate-400 mb-3">- Already Withdrawn</h4>
          <div className="space-y-1.5">
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(withdrawnBase, baseTokenDecimals)} {baseTokenSymbol}
            </div>
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(withdrawnQuote, quoteTokenDecimals)} {quoteTokenSymbol}
            </div>
          </div>
        </div>

        {/* Box C: Current Holdings in Position */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-sm font-semibold text-slate-400 mb-3">- {isClosed ? "Holdings at Close" : "Current Holdings in Position"}</h4>
          <div className="space-y-1.5">
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(currentBase, baseTokenDecimals)} {baseTokenSymbol}
            </div>
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(currentQuote, quoteTokenDecimals)} {quoteTokenSymbol}
            </div>
          </div>
        </div>

        {/* Box D: Net Conversion */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-sm font-semibold text-slate-400 mb-3">= Net Conversion</h4>
          <div className="space-y-1.5">
            <div className={`text-lg font-semibold ${netDepositBase - withdrawnBase - currentBase >= 0n ? "text-green-400" : "text-red-400"}`}>
              {netDepositBase - withdrawnBase - currentBase >= 0n ? "+" : ""}{formatCompactValue(netDepositBase - withdrawnBase - currentBase, baseTokenDecimals)} {baseTokenSymbol}
            </div>
            <div className={`text-lg font-semibold ${netDepositQuote - withdrawnQuote - currentQuote >= 0n ? "text-green-400" : "text-red-400"}`}>
              {netDepositQuote - withdrawnQuote - currentQuote >= 0n ? "+" : ""}{formatCompactValue(netDepositQuote - withdrawnQuote - currentQuote, quoteTokenDecimals)} {quoteTokenSymbol}
            </div>
          </div>
        </div>
      </div>

      {/* Box C: Execution by Position */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
        <h4 className="text-sm font-semibold text-slate-400 mb-3">Execution by Position</h4>
        <div className="space-y-2">
          {direction ? (
            <div className="flex justify-between items-center text-sm">
              <span>
                <span className={directionColor}>{direction}</span>{" "}
                <span className="text-slate-500">
                  @ {formatCompactValue(netRebalancingAvgPrice, quoteTokenDecimals)} {quoteTokenSymbol}
                </span>
              </span>
              <span className="text-white font-medium">
                {formatCompactValue(absNetBase, baseTokenDecimals)} {baseTokenSymbol}{" "}
                for {formatCompactValue(absNetQuote, quoteTokenDecimals)} {quoteTokenSymbol}
              </span>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No rebalancing activity</p>
          )}
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">{netBase < 0n ? "Premium" : "Discount"} Earned (i.e. fees)</span>
            <span className="text-white font-medium">
              {netBase < 0n ? "+" : "-"}{formatCompactValue(totalPremium, quoteTokenDecimals)} {quoteTokenSymbol}
            </span>
          </div>
          <div className="border-t border-slate-600/50 pt-2 mt-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-white font-medium">Total</span>
              <span className="text-white font-medium">
                {formatCompactValue(
                  netBase < 0n
                    ? absNetQuote + totalPremium
                    : absNetQuote - totalPremium,
                  quoteTokenDecimals
                )} {quoteTokenSymbol}
              </span>
            </div>
            {absNetBase > 0n && (
              <div className="flex justify-between items-center text-sm mt-2">
                <span className="text-yellow-400 font-medium">Effective Execution Price</span>
                <span className="text-yellow-400 font-medium">
                  {formatCompactValue(
                    (netBase < 0n
                      ? absNetQuote + totalPremium
                      : absNetQuote - totalPremium
                    ) * 10n ** BigInt(baseTokenDecimals) / absNetBase,
                    quoteTokenDecimals
                  )} {quoteTokenSymbol}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* vs. Current Spot Market */}
      {direction && (() => {
        const quoteAtSpot = absNetBase * currentSpotPrice / (10n ** BigInt(baseTokenDecimals));
        const effectiveQuote = netBase < 0n
          ? absNetQuote + totalPremium
          : absNetQuote - totalPremium;
        const difference = netBase < 0n
          ? effectiveQuote - quoteAtSpot
          : quoteAtSpot - effectiveQuote;
        const absDifference = difference < 0n ? -difference : difference;
        const isFavorable = difference > 0n;
        const comparisonLabel = netBase < 0n
          ? (isFavorable ? "premium" : "discount")
          : (isFavorable ? "discount" : "premium");
        const comparisonColor = isFavorable ? "text-green-400" : "text-red-400";

        return (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
            <h4 className="text-sm font-semibold text-slate-400 mb-3">{isClosed ? `vs. Spot Market ${daysLabel}` : "vs. Current Spot Market"}</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span>
                  <span className={directionColor}>{netBase < 0n ? `If held and sold ${daysLabel}` : `If waited and bought ${daysLabel}`}</span>{" "}
                  <span className="text-slate-500">
                    @ {formatCompactValue(currentSpotPrice, quoteTokenDecimals)} {quoteTokenSymbol}
                  </span>
                </span>
                <span className="text-white font-medium">
                  {formatCompactValue(absNetBase, baseTokenDecimals)} {baseTokenSymbol}{" "}
                  for {formatCompactValue(quoteAtSpot, quoteTokenDecimals)} {quoteTokenSymbol}
                </span>
              </div>
              <div className="border-t border-slate-600/50 pt-2">
                <p className="text-sm text-slate-300">
                  Including earned fees, you {direction.toLowerCase()} at a{" "}
                  <span className={comparisonColor}>{comparisonLabel}</span> of{" "}
                  {formatCompactValue(absDifference, quoteTokenDecimals)} {quoteTokenSymbol} vs. {isClosed ? `market ${daysLabel}` : "the current market"}.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* vs. Spot Market at Deposit */}
      {direction && netDepositAvgPrice > 0n && (() => {
        const quoteAtDeposit = absNetBase * netDepositAvgPrice / (10n ** BigInt(baseTokenDecimals));
        const effectiveQuote = netBase < 0n
          ? absNetQuote + totalPremium
          : absNetQuote - totalPremium;
        const difference = netBase < 0n
          ? effectiveQuote - quoteAtDeposit
          : quoteAtDeposit - effectiveQuote;
        const absDifference = difference < 0n ? -difference : difference;
        const isFavorable = difference > 0n;
        const comparisonLabel = netBase < 0n
          ? (isFavorable ? "premium" : "discount")
          : (isFavorable ? "discount" : "premium");
        const comparisonColor = isFavorable ? "text-green-400" : "text-red-400";

        return (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
            <h4 className="text-sm font-semibold text-slate-400 mb-3">vs. Spot Market at Deposit</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span>
                  <span className={directionColor}>{netBase < 0n ? "If sold instead of deposited" : "If bought instead of deposited"}</span>{" "}
                  <span className="text-slate-500">
                    @ {formatCompactValue(netDepositAvgPrice, quoteTokenDecimals)} {quoteTokenSymbol}
                  </span>
                </span>
                <span className="text-white font-medium">
                  {formatCompactValue(absNetBase, baseTokenDecimals)} {baseTokenSymbol}{" "}
                  for {formatCompactValue(quoteAtDeposit, quoteTokenDecimals)} {quoteTokenSymbol}
                </span>
              </div>
              <div className="border-t border-slate-600/50 pt-2">
                <p className="text-sm text-slate-300">
                  Including earned fees, you {direction.toLowerCase()} at a{" "}
                  <span className={comparisonColor}>{comparisonLabel}</span> of{" "}
                  {formatCompactValue(absDifference, quoteTokenDecimals)} {quoteTokenSymbol} vs. market at deposit.
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
