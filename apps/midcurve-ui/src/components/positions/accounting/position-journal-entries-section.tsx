import type { JournalEntryData, JournalLineData } from '@midcurve/api-shared';
import { formatReportingAmount } from '@midcurve/shared';

interface PositionJournalEntriesSectionProps {
  entries: JournalEntryData[];
  reportingCurrency: string;
}

export function PositionJournalEntriesSection({ entries, reportingCurrency }: PositionJournalEntriesSectionProps) {
  return (
    <section>
      <header className="mb-3">
        <h3 className="text-white font-semibold">Journal Entries</h3>
        <p className="text-xs text-slate-500">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · Chronological · {reportingCurrency}
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-slate-700/50 py-8 text-center text-slate-400 text-sm">
          No journal entries for this position.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700/50 divide-y divide-slate-700/50">
          {entries.map((entry) => (
            <EntryBlock key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function EntryBlock({ entry }: { entry: JournalEntryData }) {
  const formattedDate = new Date(entry.entryDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-slate-400 text-xs font-mono shrink-0">{formattedDate}</span>
          <span className="text-slate-200 text-sm truncate">{entry.description}</span>
        </div>
        {entry.memo && <span className="text-slate-500 text-xs shrink-0">{entry.memo}</span>}
      </div>

      <table className="w-full text-xs ml-4">
        <tbody>
          {entry.lines.map((line, idx) => (
            <LineRow key={idx} line={line} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineRow({ line }: { line: JournalLineData }) {
  const sideLabel = line.side === 'debit' ? 'DR' : 'CR';
  const sideColor = line.side === 'debit' ? 'text-amber-400' : 'text-sky-400';
  const amount = line.amountReporting ? formatReportingAmount(line.amountReporting) : '—';

  return (
    <tr>
      <td className={`py-0.5 pr-3 font-mono w-8 ${sideColor}`}>{sideLabel}</td>
      <td className="py-0.5 pr-3 text-slate-500 font-mono w-16">{line.accountCode}</td>
      <td className="py-0.5 text-slate-300">{line.accountName}</td>
      <td className="py-0.5 pl-3 text-right text-slate-300 font-mono">{amount}</td>
    </tr>
  );
}
