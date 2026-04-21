import type { PositionPnl } from '@midcurve/api-shared';
import { formatReportingAmount } from '@midcurve/shared';

interface PositionPnlSectionProps {
  data: PositionPnl;
  reportingCurrency: string;
}

export function PositionPnlSection({ data, reportingCurrency }: PositionPnlSectionProps) {
  return (
    <section>
      <header className="mb-3">
        <h3 className="text-white font-semibold">P&amp;L Statement</h3>
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
            <Row label="Realized from Withdrawals" value={data.realizedFromWithdrawals} />
            <Row label="Realized from Collected Fees" value={data.realizedFromCollectedFees} />
            <Row label="Realized from FX Effect" value={data.realizedFromFxEffect} />
            <TotalRow label="Net Realized P&L" value={data.netPnl} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="hover:bg-slate-800/30">
      <td className="py-1.5 px-4 pl-8 text-slate-300">{label}</td>
      <td className={`py-1.5 px-4 text-right ${valueColor(value)}`}>{formatReportingAmount(value)}</td>
    </tr>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-slate-700/50 font-semibold">
      <td className="py-2 px-4 text-white">{label}</td>
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
