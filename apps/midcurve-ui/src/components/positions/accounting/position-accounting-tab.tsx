/**
 * PositionAccountingTab — Protocol-agnostic accounting view for a single position.
 *
 * Renders three stacked sections, in order:
 *   1. Balance Sheet  (lifetime, realized only)
 *   2. P&L Statement  (lifetime, realized only)
 *   3. Journal Entries (full audit trail, chronological)
 *
 * All data comes from one endpoint — the parent detail page owns the protocol-
 * specific React Query hook and feeds `data` + `isLoading` as props.
 */

import type { PositionAccountingResponse } from '@midcurve/api-shared';
import { PositionBalanceSheetSection } from './position-balance-sheet-section';
import { PositionPnlSection } from './position-pnl-section';
import { PositionJournalEntriesSection } from './position-journal-entries-section';

interface PositionAccountingTabProps {
  data: PositionAccountingResponse | undefined;
  isLoading: boolean;
}

export function PositionAccountingTab({ data, isLoading }: PositionAccountingTabProps) {
  if (isLoading && !data) {
    return (
      <div className="text-center py-12 text-slate-400">Loading accounting report…</div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-slate-400">
        No accounting data available for this position.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PositionBalanceSheetSection data={data.balanceSheet} reportingCurrency={data.reportingCurrency} />
      <PositionPnlSection data={data.pnl} reportingCurrency={data.reportingCurrency} />
      <PositionJournalEntriesSection entries={data.journalEntries} reportingCurrency={data.reportingCurrency} />
    </div>
  );
}
