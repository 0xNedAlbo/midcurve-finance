"use client";

import { formatCompactValue } from "@/lib/fraction-format";

interface HedgePnLComparisonProps {
  // Position metrics
  positionUnrealizedPnl: bigint;
  positionRealizedPnl: bigint;

  // Hedge metrics
  hedgeUnrealizedPnl: bigint;
  hedgeRealizedPnl: bigint;

  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
}

export function HedgePnLComparison({
  positionUnrealizedPnl,
  positionRealizedPnl,
  hedgeUnrealizedPnl,
  hedgeRealizedPnl,
  quoteTokenSymbol,
  quoteTokenDecimals,
}: HedgePnLComparisonProps) {
  // Calculate totals
  const positionTotalPnl = positionUnrealizedPnl + positionRealizedPnl;
  const hedgeTotalPnl = hedgeUnrealizedPnl + hedgeRealizedPnl;
  const combinedUnrealizedPnl = positionUnrealizedPnl + hedgeUnrealizedPnl;
  const combinedRealizedPnl = positionRealizedPnl + hedgeRealizedPnl;
  const combinedTotalPnl = positionTotalPnl + hedgeTotalPnl;

  // Get color based on value
  const getValueColor = (value: bigint) => {
    if (value > 0n) return "text-green-400";
    if (value < 0n) return "text-red-400";
    return "text-slate-400";
  };

  // Format value with sign
  const formatWithSign = (value: bigint) => {
    const formatted = formatCompactValue(value, quoteTokenDecimals);
    if (value > 0n && !formatted.startsWith("+")) {
      return `+${formatted}`;
    }
    return formatted;
  };

  const rows = [
    {
      label: "Unrealized PnL",
      position: positionUnrealizedPnl,
      hedge: hedgeUnrealizedPnl,
      combined: combinedUnrealizedPnl,
    },
    {
      label: "Realized PnL",
      position: positionRealizedPnl,
      hedge: hedgeRealizedPnl,
      combined: combinedRealizedPnl,
    },
    {
      label: "Total PnL",
      position: positionTotalPnl,
      hedge: hedgeTotalPnl,
      combined: combinedTotalPnl,
      isTotal: true,
    },
  ];

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700/50">
        <h3 className="text-lg font-semibold text-white">PnL Comparison</h3>
        <p className="text-sm text-slate-400 mt-1">
          Compare position and hedge performance
        </p>
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-700/30">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Metric
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                Position
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                Hedge
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-blue-300 uppercase tracking-wider">
                Combined
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {rows.map((row) => (
              <tr
                key={row.label}
                className={row.isTotal ? "bg-slate-700/20" : "hover:bg-slate-700/20"}
              >
                <td className={`px-6 py-4 whitespace-nowrap text-sm ${row.isTotal ? "font-semibold text-white" : "text-slate-300"}`}>
                  {row.label}
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${row.isTotal ? "font-semibold" : ""} ${getValueColor(row.position)}`}>
                  {formatWithSign(row.position)} {quoteTokenSymbol}
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${row.isTotal ? "font-semibold" : ""} ${getValueColor(row.hedge)}`}>
                  {formatWithSign(row.hedge)} {quoteTokenSymbol}
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${row.isTotal ? "font-bold" : "font-medium"} ${getValueColor(row.combined)}`}>
                  {formatWithSign(row.combined)} {quoteTokenSymbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden p-4 space-y-4">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`p-4 rounded-lg ${row.isTotal ? "bg-slate-700/40" : "bg-slate-700/20"}`}
          >
            <div className={`text-sm mb-3 ${row.isTotal ? "font-semibold text-white" : "text-slate-300"}`}>
              {row.label}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-xs text-slate-400 mb-1">Position</div>
                <div className={`text-sm ${row.isTotal ? "font-semibold" : ""} ${getValueColor(row.position)}`}>
                  {formatWithSign(row.position)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">Hedge</div>
                <div className={`text-sm ${row.isTotal ? "font-semibold" : ""} ${getValueColor(row.hedge)}`}>
                  {formatWithSign(row.hedge)}
                </div>
              </div>
              <div>
                <div className="text-xs text-blue-400 mb-1">Combined</div>
                <div className={`text-sm ${row.isTotal ? "font-bold" : "font-medium"} ${getValueColor(row.combined)}`}>
                  {formatWithSign(row.combined)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Hedge Effectiveness Indicator */}
      <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-700/20">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Hedge Effectiveness</span>
          <div className="flex items-center gap-2">
            {combinedTotalPnl >= 0n ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-sm text-green-400">Positive Combined PnL</span>
              </>
            ) : Math.abs(Number(combinedTotalPnl)) < Math.abs(Number(positionTotalPnl)) ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-sm text-amber-400">Partially Hedged</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-sm text-red-400">Loss Amplified</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
