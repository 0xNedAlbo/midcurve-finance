"use client";

import { formatCompactValue } from "@/lib/fraction-format";
import { calculateAprSummary } from "@/lib/apr-utils";
import type { AprPeriodData } from "@midcurve/api-shared";

interface AprBreakdownProps {
  periods: AprPeriodData[];
  currentCostBasis: string; // Current position cost basis (for unrealized calculation)
  unclaimedFees: string; // Current unclaimed fees (for unrealized calculation)
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
}

export function AprBreakdown({
  periods,
  currentCostBasis,
  unclaimedFees,
  quoteTokenSymbol,
  quoteTokenDecimals,
}: AprBreakdownProps) {
  const summary = calculateAprSummary(
    periods,
    BigInt(currentCostBasis),
    BigInt(unclaimedFees)
  );

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <h3 className="text-lg font-semibold text-white mb-6">APR Breakdown</h3>

      <div className="space-y-6">
        {/* Total APR at top */}
        <div className="border-b border-slate-600/50 pb-4">
          <div className="flex items-center">
            <span className="text-lg font-semibold text-slate-300">Total APR:</span>
            <span className="text-xl font-bold text-green-400 ml-2">
              {summary.totalApr.toFixed(2)}%
            </span>
            <span className="text-sm text-slate-400 ml-2">
              (over {summary.totalActiveDays} days)
            </span>
          </div>
        </div>

        {/* Two Column Layout for Realized and Unrealized APR */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Realized APR Column */}
          <div className="space-y-3">
            <h4 className="text-md font-semibold text-white">Realized APR</h4>
            <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Total Fees Collected</span>
                <span className="text-white font-medium">
                  {formatCompactValue(summary.realizedFees, quoteTokenDecimals)}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Time-Weighted Cost Basis</span>
                <span className="text-white font-medium">
                  {formatCompactValue(
                    summary.realizedTWCostBasis,
                    quoteTokenDecimals
                  )}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Active Days</span>
                <span className="text-white font-medium">
                  {summary.realizedActiveDays} days
                </span>
              </div>
              <div className="border-t border-slate-600/50 pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-white font-medium">= Realized APR</span>
                  <span className="font-bold text-green-400">
                    {summary.realizedApr.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Unrealized APR Column */}
          <div className="space-y-3">
            <h4 className="text-md font-semibold text-white">Unrealized APR</h4>
            <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Unclaimed Fees</span>
                <span className="text-white font-medium">
                  {formatCompactValue(
                    summary.unrealizedFees,
                    quoteTokenDecimals
                  )}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Current Cost Basis</span>
                <span className="text-white font-medium">
                  {formatCompactValue(
                    summary.unrealizedCostBasis,
                    quoteTokenDecimals
                  )}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Days Since Last Collect</span>
                <span className="text-white font-medium">
                  {summary.unrealizedCostBasis > 0n
                    ? `${summary.unrealizedActiveDays} days`
                    : "-"}
                </span>
              </div>
              <div className="border-t border-slate-600/50 pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-white font-medium">= Estimated APR</span>
                  <span className="font-bold text-green-400">
                    {summary.unrealizedApr.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
