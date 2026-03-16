/**
 * AccountingSummary - Main container for the Accounting tab.
 *
 * Two sub-tabs: Balance Sheet | P&L Statement
 * Shared period selector.
 * All selections (sub-tab, period, offset) are stored in URL search params
 * so that browser back/forward navigation works.
 */

import { useSearchParams } from 'react-router-dom';
import type { PeriodQuery } from '@midcurve/api-shared';
import { useBalanceSheet } from '@/hooks/accounting/useBalanceSheet';
import { usePnl } from '@/hooks/accounting/usePnl';
import { AccountingPeriodSelector } from './accounting-period-selector';
import { BalanceSheetTable } from './balance-sheet-table';
import { PnlStatement } from './pnl-statement';

type SubTab = 'balance-sheet' | 'pnl';

const validPeriods: PeriodQuery[] = ['day', 'week', 'month', 'quarter', 'year'];
const validSubTabs: SubTab[] = ['balance-sheet', 'pnl'];

function parsePeriod(value: string | null): PeriodQuery {
  return validPeriods.includes(value as PeriodQuery) ? (value as PeriodQuery) : 'week';
}

function parseSubTab(value: string | null): SubTab {
  return validSubTabs.includes(value as SubTab) ? (value as SubTab) : 'balance-sheet';
}

function parseOffset(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(n, 0) : 0;
}

export function AccountingSummary() {
  const [searchParams, setSearchParams] = useSearchParams();

  const period = parsePeriod(searchParams.get('period'));
  const activeTab = parseSubTab(searchParams.get('view'));
  const offset = parseOffset(searchParams.get('offset'));

  const updateParams = (updates: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      return next;
    });
  };

  const handlePeriodChange = (newPeriod: PeriodQuery) => {
    updateParams({
      period: newPeriod === 'week' ? null : newPeriod,
      offset: null,
    });
  };

  const handleSubTabChange = (tab: SubTab) => {
    updateParams({ view: tab === 'balance-sheet' ? null : tab });
  };

  const handleOffsetChange = (newOffset: number) => {
    updateParams({ offset: newOffset === 0 ? null : String(newOffset) });
  };

  const { data: balanceSheet } = useBalanceSheet(period, offset);
  const { data: pnl } = usePnl(period, offset);
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex gap-1">
          <TabButton
            label="Balance Sheet"
            active={activeTab === 'balance-sheet'}
            onClick={() => handleSubTabChange('balance-sheet')}
          />
          <TabButton
            label="P&L Statement"
            active={activeTab === 'pnl'}
            onClick={() => handleSubTabChange('pnl')}
          />
        </div>

        <AccountingPeriodSelector activePeriod={period} onPeriodChange={handlePeriodChange} />
      </div>

      {/* Date range with period navigation */}
      {pnl && (
        <div className="flex items-center justify-end gap-2 -mt-4">
          <button
            onClick={() => handleOffsetChange(offset - 1)}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Previous period"
          >
            &#x2039;
          </button>
          <span className="text-xs text-slate-500">
            {new Date(pnl.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' — '}
            {new Date(pnl.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button
            onClick={() => handleOffsetChange(offset + 1)}
            disabled={offset >= 0}
            className={`p-1 transition-colors cursor-pointer ${
              offset >= 0
                ? 'text-slate-700 cursor-not-allowed'
                : 'text-slate-400 hover:text-white'
            }`}
            aria-label="Next period"
          >
            &#x203a;
          </button>
        </div>
      )}

      {/* Content */}
      {activeTab === 'balance-sheet' ? (
        <BalanceSheetTable data={balanceSheet} />
      ) : (
        <PnlStatement data={pnl} />
      )}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
        active
          ? 'bg-slate-700/50 text-white'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
      }`}
    >
      {label}
    </button>
  );
}
