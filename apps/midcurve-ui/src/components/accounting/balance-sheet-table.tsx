/**
 * BalanceSheetTable - Full balance sheet with period-over-period comparison.
 *
 * Four-column table: Current | Previous | Δ Abs | Δ %
 * Three sections: Assets, Liabilities, Equity with retained earnings sub-items.
 */

import type { BalanceSheetResponse, BalanceSheetLineItem } from '@midcurve/api-shared';
import { formatReportingAmount } from '@midcurve/shared';

interface BalanceSheetTableProps {
  data: BalanceSheetResponse | undefined;
}

export function BalanceSheetTable({ data }: BalanceSheetTableProps) {
  if (!data) {
    return (
      <div className="text-center py-12 text-slate-400">
        No balance sheet data available. Track positions to get started.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 text-xs border-b border-slate-700/50">
            <th className="text-left py-3 px-4 font-medium w-1/3">Line Item</th>
            <th className="text-right py-3 px-4 font-medium">Current</th>
            <th className="text-right py-3 px-4 font-medium">Previous</th>
            <th className="text-right py-3 px-4 font-medium">Δ Abs.</th>
            <th className="text-right py-3 px-4 font-medium">Δ %</th>
          </tr>
        </thead>
        <tbody>
          {/* Assets Section */}
          <SectionHeader label="Assets" />
          <LineItemRow label="Deposited Liquidity at Cost" item={data.assets.depositedLiquidityAtCost} indent={1} />
          <LineItemRow label="Mark-to-Market Adjustment" item={data.assets.markToMarketAdjustment} indent={1} />
          <LineItemRow label="Unclaimed Fees" item={data.assets.unclaimedFees} indent={1} />
          <TotalRow label="Total Assets" item={data.assets.totalAssets} />

          <SpacerRow />

          {/* Liabilities Section */}
          <SectionHeader label="Liabilities" />
          <TotalRow label="Total Liabilities" item={data.liabilities.totalLiabilities} />

          <SpacerRow />

          {/* Equity Section */}
          <SectionHeader label="Equity" />
          <LineItemRow label="Contributed Capital" item={data.equity.contributedCapital} indent={1} />
          <LineItemRow label="Capital Returned" item={data.equity.capitalReturned} indent={1} />

          <SubSectionHeader label="Retained Earnings" />
          <LineItemRow label="Realized: Withdrawals" item={data.equity.retainedEarnings.realizedFromWithdrawals} indent={2} />
          <LineItemRow label="Realized: Collected Fees" item={data.equity.retainedEarnings.realizedFromCollectedFees} indent={2} />
          <LineItemRow label="Unrealized: Price Changes" item={data.equity.retainedEarnings.unrealizedFromPriceChanges} indent={2} />
          <LineItemRow label="Unrealized: Unclaimed Fees" item={data.equity.retainedEarnings.unrealizedFromUnclaimedFees} indent={2} />
          <TotalRow label="Total Retained Earnings" item={data.equity.retainedEarnings.totalRetainedEarnings} indent={1} />
          <TotalRow label="Total Equity" item={data.equity.totalEquity} />
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="border-t border-slate-700/30">
      <td colSpan={5} className="py-2 px-4 text-slate-300 font-semibold text-xs uppercase tracking-wider">
        {label}
      </td>
    </tr>
  );
}

function SubSectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} className="py-1.5 px-4 pl-8 text-slate-400 font-medium text-xs">
        {label}
      </td>
    </tr>
  );
}

function SpacerRow() {
  return <tr className="h-2" />;
}

function LineItemRow({ label, item, indent = 0 }: { label: string; item: BalanceSheetLineItem; indent?: number }) {
  const paddingLeft = indent === 0 ? 'pl-4' : indent === 1 ? 'pl-8' : 'pl-12';

  return (
    <tr className="hover:bg-slate-800/30">
      <td className={`py-1.5 px-4 ${paddingLeft} text-slate-300`}>{label}</td>
      <td className={`py-1.5 px-4 text-right ${valueColor(item.current)}`}>
        {formatValue(item.current)}
      </td>
      <td className="py-1.5 px-4 text-right text-slate-500">
        {item.previous !== null ? formatValue(item.previous) : '—'}
      </td>
      <td className={`py-1.5 px-4 text-right ${item.deltaAbs !== null ? valueColor(item.deltaAbs) : ''}`}>
        {item.deltaAbs !== null ? formatValue(item.deltaAbs) : '—'}
      </td>
      <td className={`py-1.5 px-4 text-right ${item.deltaPct !== null ? valueColor(item.deltaPct) : ''}`}>
        {formatPct(item.deltaPct)}
      </td>
    </tr>
  );
}

function TotalRow({ label, item, indent = 0 }: { label: string; item: BalanceSheetLineItem; indent?: number }) {
  const paddingLeft = indent === 0 ? 'pl-4' : indent === 1 ? 'pl-8' : 'pl-12';

  return (
    <tr className="border-t border-slate-700/50 font-semibold">
      <td className={`py-2 px-4 ${paddingLeft} text-white`}>{label}</td>
      <td className={`py-2 px-4 text-right ${valueColor(item.current)}`}>
        {formatValue(item.current)}
      </td>
      <td className="py-2 px-4 text-right text-slate-500">
        {item.previous !== null ? formatValue(item.previous) : '—'}
      </td>
      <td className={`py-2 px-4 text-right ${item.deltaAbs !== null ? valueColor(item.deltaAbs) : ''}`}>
        {item.deltaAbs !== null ? formatValue(item.deltaAbs) : '—'}
      </td>
      <td className={`py-2 px-4 text-right ${item.deltaPct !== null ? valueColor(item.deltaPct) : ''}`}>
        {formatPct(item.deltaPct)}
      </td>
    </tr>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatValue(value: string): string {
  return formatReportingAmount(value);
}

function formatPct(deltaPct: string | null): string {
  if (deltaPct === null) return '—';
  const bps = BigInt(deltaPct);
  const sign = bps > 0n ? '+' : '';
  // Convert basis points to percentage: bps / 100
  const whole = bps / 100n;
  const frac = (bps < 0n ? -bps : bps) % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}%`;
}

function valueColor(value: string): string {
  const n = BigInt(value);
  if (n < 0n) return 'text-red-400';
  if (n > 0n) return 'text-emerald-400';
  return 'text-slate-400';
}
