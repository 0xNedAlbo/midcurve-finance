/**
 * AccountingSummaryCards - Summary metric cards for NAV, P&L breakdown
 */

import type { BalanceSheetResponse, PnlResponse, PeriodComparisonResponse } from '@midcurve/api-shared';
import { formatReportingAmount } from '@/lib/format-helpers';

interface AccountingSummaryCardsProps {
  balanceSheet: BalanceSheetResponse | undefined;
  pnl: PnlResponse | undefined;
  periodComparison: PeriodComparisonResponse | undefined;
}

function valueColor(value: string): string {
  const n = parseFloat(value);
  if (n > 0) return 'text-green-400';
  if (n < 0) return 'text-red-400';
  return 'text-white';
}

function DeltaBadge({ value }: { value: string }) {
  const pct = parseFloat(value);
  if (isNaN(pct)) return null;
  const sign = pct >= 0 ? '+' : '';
  const color = pct >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={`text-xs ${color}`}>{sign}{pct.toFixed(2)}%</span>;
}

export function AccountingSummaryCards({
  balanceSheet,
  pnl,
  periodComparison,
}: AccountingSummaryCardsProps) {
  const cards = [
    {
      label: 'Net Asset Value',
      value: balanceSheet ? formatReportingAmount(balanceSheet.netAssetValue) : '—',
      delta: periodComparison?.delta?.netAssetValuePct,
      colorClass: 'text-white',
    },
    {
      label: 'Net P&L',
      value: pnl ? formatReportingAmount(pnl.netPnl) : '—',
      colorClass: pnl ? valueColor(pnl.netPnl) : 'text-white',
    },
    {
      label: 'Fee Income',
      value: pnl ? formatReportingAmount(pnl.feeIncome) : '—',
      colorClass: pnl ? valueColor(pnl.feeIncome) : 'text-white',
    },
    {
      label: 'Realized P&L',
      value: pnl ? formatReportingAmount(pnl.realizedPnl) : '—',
      colorClass: pnl ? valueColor(pnl.realizedPnl) : 'text-white',
    },
    {
      label: 'Unrealized P&L',
      value: pnl ? formatReportingAmount(pnl.unrealizedPnl) : '—',
      colorClass: pnl ? valueColor(pnl.unrealizedPnl) : 'text-white',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4"
        >
          <p className="text-xs text-slate-400 mb-1">{card.label}</p>
          <p className={`text-lg font-semibold ${card.colorClass}`}>
            {card.value}
          </p>
          {card.delta && <DeltaBadge value={card.delta} />}
        </div>
      ))}
    </div>
  );
}
