"use client";

import type { OptionalitySummaryData } from "@midcurve/api-shared";
import { formatCompactValue } from "@/lib/fraction-format";

interface OptionalitySummaryProps {
  summary?: OptionalitySummaryData;
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
  } = summary;

  const totalPremium = BigInt(summary.totalPremium);
  const netBase = BigInt(summary.netRebalancingBase);
  const netQuote = BigInt(summary.netRebalancingQuote);
  const netDepositBase = BigInt(summary.netDepositBase);

  // Build single narrative line from net rebalancing
  let narrative: string;
  if (netBase < 0n) {
    narrative = `The position sold ${formatCompactValue(-netBase, baseTokenDecimals)} ${baseTokenSymbol} at an average price of ${formatCompactValue(BigInt(summary.netRebalancingAvgPrice), quoteTokenDecimals)} ${quoteTokenSymbol}, earning ${formatCompactValue(totalPremium, quoteTokenDecimals)} ${quoteTokenSymbol} in premium.`;
  } else if (netBase > 0n) {
    narrative = `The position bought ${formatCompactValue(netBase, baseTokenDecimals)} ${baseTokenSymbol} at an average price of ${formatCompactValue(BigInt(summary.netRebalancingAvgPrice), quoteTokenDecimals)} ${quoteTokenSymbol}, earning ${formatCompactValue(totalPremium, quoteTokenDecimals)} ${quoteTokenSymbol} in premium.`;
  } else {
    narrative = "No rebalancing has occurred yet.";
  }

  // Direction label and color for Box C
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

      {/* Box A + Box B */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Box A: Deposits */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-sm font-semibold text-slate-400 mb-3">Deposits</h4>
          <div className="space-y-1.5">
            <div>
              <span className="text-white text-lg font-semibold">
                {formatCompactValue(netDepositBase, baseTokenDecimals)} {baseTokenSymbol}
              </span>
              {BigInt(summary.netDepositAvgPrice) > 0n && (
                <span className="text-slate-500 text-lg ml-1">
                  @ {formatCompactValue(BigInt(summary.netDepositAvgPrice), quoteTokenDecimals)} {quoteTokenSymbol}
                </span>
              )}
            </div>
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(BigInt(summary.netDepositQuote), quoteTokenDecimals)} {quoteTokenSymbol}
            </div>
          </div>
        </div>

        {/* Box B: Current Holdings in Position */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
          <h4 className="text-sm font-semibold text-slate-400 mb-3">Current Holdings in Position</h4>
          <div className="space-y-1.5">
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(BigInt(summary.currentBase), baseTokenDecimals)} {baseTokenSymbol}
            </div>
            <div className="text-white text-lg font-semibold">
              {formatCompactValue(BigInt(summary.currentQuote), quoteTokenDecimals)} {quoteTokenSymbol}
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
                  @ {formatCompactValue(BigInt(summary.netRebalancingAvgPrice), quoteTokenDecimals)} {quoteTokenSymbol}
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
            <span className="text-slate-400">Premium Earned</span>
            <span className="text-white font-medium">
              {formatCompactValue(totalPremium, quoteTokenDecimals)} {quoteTokenSymbol}
            </span>
          </div>
          <div className="border-t border-slate-600/50 pt-2 mt-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-white font-medium">Total</span>
              <span className="text-white font-medium">
                {formatCompactValue(absNetQuote + totalPremium, quoteTokenDecimals)} {quoteTokenSymbol}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* vs. Spot Market */}
      {direction && (() => {
        const quoteAtSpot = absNetBase * BigInt(summary.currentSpotPrice) / (10n ** BigInt(baseTokenDecimals));
        // difference = what position received (rebalancing quote + fees) minus what market would give now
        const difference = netBase < 0n
          ? (absNetQuote + totalPremium) - quoteAtSpot   // sold: got more = premium
          : quoteAtSpot - (absNetQuote + totalPremium);  // bought: paid less = discount
        const isFavorable = difference > 0n;
        const absDifference = difference < 0n ? -difference : difference;
        const comparisonLabel = isFavorable ? "premium" : "discount";
        const comparisonColor = isFavorable ? "text-green-400" : "text-red-400";

        return (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
            <h4 className="text-sm font-semibold text-slate-400 mb-3">vs. Spot Market</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span>
                  <span className={directionColor}>{netBase < 0n ? "If held and sold now" : "If waited and bought now"}</span>{" "}
                  <span className="text-slate-500">
                    @ {formatCompactValue(BigInt(summary.currentSpotPrice), quoteTokenDecimals)} {quoteTokenSymbol}
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
                  {formatCompactValue(absDifference, quoteTokenDecimals)} {quoteTokenSymbol} vs. current market.
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
