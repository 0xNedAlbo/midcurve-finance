/**
 * PnlPositionTable - Per-instrument P&L breakdown table
 */

import type { PnlInstrumentItem } from '@midcurve/api-shared';
import { formatReportingAmount, formatFeeTier, formatProtocolName } from '@/lib/format-helpers';
import { formatChainName } from '@/lib/position-helpers';

interface PnlPositionTableProps {
  instruments: PnlInstrumentItem[] | undefined;
}

function valueColor(value: string): string {
  const n = parseFloat(value);
  if (n > 0) return 'text-green-400';
  if (n < 0) return 'text-red-400';
  return 'text-slate-300';
}

function netPnl(item: PnlInstrumentItem): bigint {
  return BigInt(item.feeIncome) + BigInt(item.realizedPnl) + BigInt(item.unrealizedPnl);
}

/** Extract NFT ID from instrumentRef like "uniswapv3/42161/5334690" */
function parseNftId(instrumentRef: string): string {
  const parts = instrumentRef.split('/');
  return parts[parts.length - 1] ?? instrumentRef;
}

export function PnlPositionTable({ instruments }: PnlPositionTableProps) {
  if (!instruments || instruments.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-8 text-center">
        <p className="text-slate-400">No tracked instruments</p>
      </div>
    );
  }

  const sorted = [...instruments].sort(
    (a, b) => {
      const absA = netPnl(a) < 0n ? -netPnl(a) : netPnl(a);
      const absB = netPnl(b) < 0n ? -netPnl(b) : netPnl(b);
      if (absB > absA) return 1;
      if (absB < absA) return -1;
      return 0;
    },
  );

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
      <h3 className="text-sm font-medium text-slate-300 px-6 py-4 border-b border-slate-700/30">
        P&L by Position
      </h3>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <table className="w-full">
          <thead className="bg-slate-700/30">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">Position</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">Fee Income</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">Realized P&L</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">Unrealized P&L</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">Net P&L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {sorted.map((item) => {
              const net = netPnl(item).toString();
              return (
                <tr key={item.instrumentRef} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="text-sm text-white font-medium">
                      {item.poolSymbol}
                      <span className="text-xs text-slate-500 ml-2">#{parseNftId(item.instrumentRef)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatProtocolName(item.protocol)} · {formatChainName(item.chainId)} · {formatFeeTier(Number(item.feeTier))}
                    </div>
                  </td>
                  <td className={`px-6 py-4 text-sm text-right ${valueColor(item.feeIncome)}`}>
                    {formatReportingAmount(item.feeIncome)}
                  </td>
                  <td className={`px-6 py-4 text-sm text-right ${valueColor(item.realizedPnl)}`}>
                    {formatReportingAmount(item.realizedPnl)}
                  </td>
                  <td className={`px-6 py-4 text-sm text-right ${valueColor(item.unrealizedPnl)}`}>
                    {formatReportingAmount(item.unrealizedPnl)}
                  </td>
                  <td className={`px-6 py-4 text-sm text-right font-semibold ${valueColor(net)}`}>
                    {formatReportingAmount(net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="lg:hidden divide-y divide-slate-700/30">
        {sorted.map((item) => {
          const net = netPnl(item).toString();
          return (
            <div key={item.instrumentRef} className="p-4 space-y-2">
              <div>
                <p className="text-sm text-white font-medium">
                  {item.poolSymbol} <span className="text-xs text-slate-500">#{parseNftId(item.instrumentRef)}</span>
                </p>
                <p className="text-xs text-slate-400">
                  {formatProtocolName(item.protocol)} · {formatChainName(item.chainId)} · {formatFeeTier(Number(item.feeTier))}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400">Fees: </span>
                  <span className={valueColor(item.feeIncome)}>{formatReportingAmount(item.feeIncome)}</span>
                </div>
                <div>
                  <span className="text-slate-400">Realized: </span>
                  <span className={valueColor(item.realizedPnl)}>{formatReportingAmount(item.realizedPnl)}</span>
                </div>
                <div>
                  <span className="text-slate-400">Unrealized: </span>
                  <span className={valueColor(item.unrealizedPnl)}>{formatReportingAmount(item.unrealizedPnl)}</span>
                </div>
                <div>
                  <span className="text-slate-400">Net: </span>
                  <span className={`font-semibold ${valueColor(net)}`}>{formatReportingAmount(net)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
