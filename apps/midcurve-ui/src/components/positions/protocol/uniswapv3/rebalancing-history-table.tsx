"use client";

import type { RebalancingSegment } from "@midcurve/shared";
import { formatCompactValue } from "@/lib/fraction-format";

interface RebalancingHistoryTableProps {
  segments: RebalancingSegment[];
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
}

function absBI(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function formatShortDate(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPeriod(segment: RebalancingSegment): string {
  const start = formatShortDate(segment.startTimestamp);
  if (segment.isTrailing) return `${start} \u2192 Now`;
  if (segment.endTimestamp) return `${start} \u2192 ${formatShortDate(segment.endTimestamp)}`;
  return start;
}

export function RebalancingHistoryTable({
  segments,
  baseTokenSymbol,
  quoteTokenSymbol,
  baseTokenDecimals,
  quoteTokenDecimals,
}: RebalancingHistoryTableProps) {
  const activeSegments = segments.filter((s) => s.deltaBase !== 0n);

  if (activeSegments.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
        <h4 className="text-sm font-semibold text-slate-400 mb-2">Rebalancing History</h4>
        <p className="text-sm text-slate-500">No rebalancing segments yet.</p>
      </div>
    );
  }

  // Cumulative totals
  const totalBase = activeSegments.reduce((acc, s) => acc + s.deltaBase, 0n);
  const totalQuote = activeSegments.reduce((acc, s) => acc + s.deltaQuote, 0n);
  const totalFees = activeSegments.reduce((acc, s) => acc + s.feesEarned, 0n);
  const scale = 10n ** BigInt(baseTokenDecimals);
  // Effective total avg price including fees
  const totalEffectiveQuote = totalBase < 0n
    ? absBI(totalQuote) + totalFees
    : absBI(totalQuote) - totalFees;
  const totalAvgPrice = totalBase !== 0n
    ? (totalEffectiveQuote * scale) / absBI(totalBase)
    : 0n;
  const totalDirection = totalBase < 0n ? "Net Sold" : totalBase > 0n ? "Net Bought" : null;
  const totalDirectionColor = totalBase < 0n ? "text-red-400" : "text-green-400";

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700/50">
        <h3 className="text-lg font-semibold text-white">Rebalancing History</h3>
        <p className="text-sm text-slate-400 mt-1">
          Per-segment token conversions by the AMM
        </p>
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-700/30">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Period
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Direction
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                {baseTokenSymbol}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                {quoteTokenSymbol}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                Execution Price
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {activeSegments.map((segment) => {
              const direction = segment.deltaBase < 0n ? "Sold" : "Bought";
              const dirColor = segment.deltaBase < 0n ? "text-red-400" : "text-green-400";

              return (
                <tr key={segment.index} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                    {formatPeriod(segment)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${dirColor}`}>{direction}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-white text-right">
                    {formatCompactValue(absBI(segment.deltaBase), baseTokenDecimals)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-white text-right">
                    {formatCompactValue(absBI(segment.deltaQuote), quoteTokenDecimals)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                    {formatCompactValue(segment.avgPrice, quoteTokenDecimals)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Totals footer */}
          <tfoot>
            <tr className="border-t-2 border-slate-600 bg-slate-700/20">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-white">
                Total
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {totalDirection && (
                  <span className={`text-sm font-semibold ${totalDirectionColor}`}>{totalDirection}</span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-white text-right">
                {formatCompactValue(absBI(totalBase), baseTokenDecimals)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-white text-right">
                {formatCompactValue(absBI(totalQuote), quoteTokenDecimals)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-300 text-right">
                {totalAvgPrice > 0n ? formatCompactValue(totalAvgPrice, quoteTokenDecimals) : "\u2014"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden divide-y divide-slate-700/30">
        {activeSegments.map((segment) => {
          const direction = segment.deltaBase < 0n ? "Sold" : "Bought";
          const dirColor = segment.deltaBase < 0n ? "text-red-400" : "text-green-400";

          return (
            <div key={segment.index} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${dirColor}`}>{direction}</span>
                <span className="text-xs text-slate-400">{formatPeriod(segment)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">{baseTokenSymbol}</span>
                <span className="text-white font-medium">
                  {formatCompactValue(absBI(segment.deltaBase), baseTokenDecimals)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">{quoteTokenSymbol}</span>
                <span className="text-white font-medium">
                  {formatCompactValue(absBI(segment.deltaQuote), quoteTokenDecimals)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Execution Price</span>
                <span className="text-slate-300">
                  {formatCompactValue(segment.avgPrice, quoteTokenDecimals)}
                </span>
              </div>
            </div>
          );
        })}

        {/* Mobile Totals */}
        <div className="p-4 space-y-3 bg-slate-700/20">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Total</span>
            {totalDirection && (
              <span className={`text-sm font-semibold ${totalDirectionColor}`}>{totalDirection}</span>
            )}
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">{baseTokenSymbol}</span>
            <span className="text-white font-semibold">
              {formatCompactValue(absBI(totalBase), baseTokenDecimals)}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">{quoteTokenSymbol}</span>
            <span className="text-white font-semibold">
              {formatCompactValue(absBI(totalQuote), quoteTokenDecimals)}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">Execution Price</span>
            <span className="text-slate-300 font-semibold">
              {totalAvgPrice > 0n ? formatCompactValue(totalAvgPrice, quoteTokenDecimals) : "\u2014"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
