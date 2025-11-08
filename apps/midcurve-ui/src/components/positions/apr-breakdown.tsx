"use client";

import { formatCompactValue } from "@/lib/fraction-format";
import type { AprPeriodData } from "@midcurve/api-shared";

interface AprBreakdownProps {
  periods: AprPeriodData[];
  currentCostBasis: string; // Current position cost basis (for unrealized calculation)
  unclaimedFees: string; // Current unclaimed fees (for unrealized calculation)
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
}

/**
 * Calculate APR summary metrics from periods array
 */
function calculateAprSummary(
  periods: AprPeriodData[],
  currentCostBasis: bigint,
  unclaimedFees: bigint
) {
  if (periods.length === 0) {
    return {
      realizedFees: 0n,
      realizedTWCostBasis: 0n,
      realizedActiveDays: 0,
      realizedApr: 0,
      unrealizedFees: unclaimedFees,
      unrealizedCostBasis: currentCostBasis,
      unrealizedActiveDays: 0,
      unrealizedApr: 0,
      totalApr: 0,
      totalActiveDays: 0,
    };
  }

  // Realized metrics (from completed periods)
  let realizedFees = 0n;
  let realizedWeightedCostBasisSum = 0n;
  let realizedTotalDays = 0;

  for (const period of periods) {
    const durationDays = period.durationSeconds / 86400;
    realizedFees += BigInt(period.collectedFeeValue);
    realizedWeightedCostBasisSum +=
      BigInt(period.costBasis) * BigInt(Math.floor(durationDays * 1000)); // Multiply by 1000 for precision
    realizedTotalDays += durationDays;
  }

  // Time-weighted cost basis = weighted sum / total days (with precision adjustment)
  const realizedTWCostBasis =
    realizedTotalDays > 0
      ? realizedWeightedCostBasisSum / BigInt(Math.floor(realizedTotalDays * 1000))
      : 0n;

  // Calculate realized APR
  // Formula: APR% = (fees / costBasis) * (365 / days) * 100
  // Rearranged: APR% = (fees * 365 * 100) / (costBasis * days)
  // Since fees and costBasis are both in same token units, they cancel out
  // We use floating point for the final calculation to avoid precision loss
  const realizedApr =
    realizedTWCostBasis > 0n && realizedTotalDays > 0
      ? (Number(realizedFees) / Number(realizedTWCostBasis)) * (365 / realizedTotalDays) * 100
      : 0;

  // Unrealized metrics (current open position)
  // Since we don't track "open periods" separately, we estimate:
  // - Unrealized cost basis = current cost basis
  // - Unrealized fees = unclaimed fees
  // - Days since last period end (or position start if no periods)
  const lastPeriodEnd = periods.length > 0 ? new Date(periods[0].endTimestamp) : null;
  const unrealizedActiveDays = lastPeriodEnd
    ? Math.max(0, (Date.now() - lastPeriodEnd.getTime()) / (1000 * 86400))
    : 0;

  // Calculate unrealized APR
  // Formula: APR% = (fees / costBasis) * (365 / days) * 100
  // Rearranged: APR% = (fees * 365 * 100) / (costBasis * days)
  // Since fees and costBasis are both in same token units, they cancel out
  // We use floating point for the final calculation to avoid precision loss
  const unrealizedApr =
    currentCostBasis > 0n && unrealizedActiveDays > 0
      ? (Number(unclaimedFees) / Number(currentCostBasis)) * (365 / unrealizedActiveDays) * 100
      : 0;

  // Total APR (time-weighted average)
  const totalActiveDays = realizedTotalDays + unrealizedActiveDays;
  const totalApr =
    totalActiveDays > 0
      ? (realizedApr * realizedTotalDays + unrealizedApr * unrealizedActiveDays) /
        totalActiveDays
      : 0;

  return {
    realizedFees,
    realizedTWCostBasis,
    realizedActiveDays: Math.floor(realizedTotalDays * 10) / 10, // Round to 1 decimal
    realizedApr,
    unrealizedFees: unclaimedFees,
    unrealizedCostBasis: currentCostBasis,
    unrealizedActiveDays: Math.floor(unrealizedActiveDays * 10) / 10, // Round to 1 decimal
    unrealizedApr,
    totalApr,
    totalActiveDays: Math.floor(totalActiveDays * 10) / 10, // Round to 1 decimal
  };
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
