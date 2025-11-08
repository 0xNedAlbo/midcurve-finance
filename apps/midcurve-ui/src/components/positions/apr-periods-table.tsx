"use client";

import { formatCompactValue } from "@/lib/fraction-format";
import type { AprPeriodData } from "@midcurve/api-shared";

interface AprPeriodsTableProps {
  periods: AprPeriodData[];
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
  isLoading?: boolean;
}

export function AprPeriodsTable({
  periods,
  quoteTokenSymbol,
  quoteTokenDecimals,
  isLoading = false,
}: AprPeriodsTableProps) {
  if (isLoading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
        <h3 className="text-lg font-semibold text-white mb-6">APR Periods</h3>
        <div className="text-center py-8">
          <div className="text-slate-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6 overflow-visible">
      <h3 className="text-lg font-semibold text-white mb-6">APR Periods</h3>

      {periods.length > 0 ? (
        <div className="overflow-x-auto" style={{ overflowY: 'visible' }}>
          <table className="w-full text-sm" style={{ overflow: 'visible' }}>
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-3 px-2 text-slate-400 font-medium">
                  Period
                </th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">
                  Duration
                </th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">
                  Cost Basis
                </th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">
                  Fees Collected
                </th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">
                  Period APR
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => {
                const startDate = new Date(period.startTimestamp);
                const durationDays = period.durationSeconds / 86400;
                const aprPercentage = period.aprBps / 100; // Convert basis points to percentage

                return (
                  <tr
                    key={period.id}
                    className="border-b border-slate-700/30 hover:bg-slate-700/20"
                  >
                    <td className="py-3 px-2">
                      <div className="text-white">
                        {startDate.toLocaleDateString()}{" "}
                        {startDate.toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right text-slate-300">
                      {durationDays.toFixed(2)} days
                    </td>
                    <td className="py-3 px-2 text-right text-slate-300">
                      {formatCompactValue(
                        BigInt(period.costBasis),
                        quoteTokenDecimals
                      )}{" "}
                      {quoteTokenSymbol}
                    </td>
                    <td className="py-3 px-2 text-right text-green-400">
                      {formatCompactValue(
                        BigInt(period.collectedFeeValue),
                        quoteTokenDecimals
                      )}{" "}
                      {quoteTokenSymbol}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span
                        className={
                          aprPercentage > 0 ? "text-green-400" : "text-slate-400"
                        }
                      >
                        {aprPercentage > 0 ? `${aprPercentage.toFixed(2)}%` : "-"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="text-slate-400">
            No APR data available. APR periods are calculated after fee collection
            events.
          </div>
        </div>
      )}
    </div>
  );
}
