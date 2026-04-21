import type { PositionBalanceSheet } from '@midcurve/api-shared';
import { formatReportingAmount } from '@midcurve/shared';

interface PositionBalanceSheetSectionProps {
  data: PositionBalanceSheet;
  reportingCurrency: string;
}

export function PositionBalanceSheetSection({ data, reportingCurrency }: PositionBalanceSheetSectionProps) {
  return (
    <section>
      <header className="mb-3">
        <h3 className="text-white font-semibold">Balance Sheet</h3>
        <p className="text-xs text-slate-500">Lifetime-to-date · Realized only · {reportingCurrency}</p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-slate-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 text-xs border-b border-slate-700/50">
              <th className="text-left py-3 px-4 font-medium w-2/3">Line Item</th>
              <th className="text-right py-3 px-4 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Assets" />
            <LineItemRow label="LP Position at Cost" value={data.assets.lpPositionAtCost} indent={1} />
            <TotalRow label="Total Assets" value={data.assets.totalAssets} />

            <SpacerRow />

            <SectionHeader label="Equity" />
            <LineItemRow label="Contributed Capital" value={data.equity.contributedCapital} indent={1} />
            <LineItemRow label="Capital Returned" value={data.equity.capitalReturned} indent={1} />

            <SubSectionHeader label="Retained Earnings" />
            <LineItemRow
              label="Realized: Withdrawals"
              value={data.equity.retainedEarnings.realizedFromWithdrawals}
              indent={2}
            />
            <LineItemRow
              label="Realized: Collected Fees"
              value={data.equity.retainedEarnings.realizedFromCollectedFees}
              indent={2}
            />
            <LineItemRow
              label="Realized: FX Effect"
              value={data.equity.retainedEarnings.realizedFromFxEffect}
              indent={2}
            />
            <TotalRow label="Total Retained Earnings" value={data.equity.retainedEarnings.total} indent={1} />
            <TotalRow label="Total Equity" value={data.equity.totalEquity} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="border-t border-slate-700/30">
      <td colSpan={2} className="py-2 px-4 text-slate-300 font-semibold text-xs uppercase tracking-wider">
        {label}
      </td>
    </tr>
  );
}

function SubSectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="py-1.5 px-4 pl-8 text-slate-400 font-medium text-xs">
        {label}
      </td>
    </tr>
  );
}

function SpacerRow() {
  return <tr className="h-2" />;
}

function LineItemRow({ label, value, indent = 0 }: { label: string; value: string; indent?: number }) {
  const paddingLeft = indent === 0 ? 'pl-4' : indent === 1 ? 'pl-8' : 'pl-12';
  return (
    <tr className="hover:bg-slate-800/30">
      <td className={`py-1.5 px-4 ${paddingLeft} text-slate-300`}>{label}</td>
      <td className={`py-1.5 px-4 text-right ${valueColor(value)}`}>{formatReportingAmount(value)}</td>
    </tr>
  );
}

function TotalRow({ label, value, indent = 0 }: { label: string; value: string; indent?: number }) {
  const paddingLeft = indent === 0 ? 'pl-4' : indent === 1 ? 'pl-8' : 'pl-12';
  return (
    <tr className="border-t border-slate-700/50 font-semibold">
      <td className={`py-2 px-4 ${paddingLeft} text-white`}>{label}</td>
      <td className={`py-2 px-4 text-right ${valueColor(value)}`}>{formatReportingAmount(value)}</td>
    </tr>
  );
}

function valueColor(value: string): string {
  const n = BigInt(value);
  if (n < 0n) return 'text-red-400';
  if (n > 0n) return 'text-emerald-400';
  return 'text-slate-400';
}
