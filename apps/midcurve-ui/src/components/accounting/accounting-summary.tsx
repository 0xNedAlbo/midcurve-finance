/**
 * AccountingSummary - Main container for the Summary tab.
 *
 * Two sub-tabs: Balance Sheet | P&L Statement
 * Shared period selector + refresh button.
 */

import { useState } from 'react';
import type { PeriodQuery } from '@midcurve/api-shared';
import { useBalanceSheet } from '@/hooks/accounting/useBalanceSheet';
import { usePnl } from '@/hooks/accounting/usePnl';
import { useRefreshAllPositions } from '@/hooks/accounting/useRefreshAllPositions';
import { AccountingPeriodSelector } from './accounting-period-selector';
import { BalanceSheetTable } from './balance-sheet-table';
import { PnlStatement } from './pnl-statement';

type SubTab = 'balance-sheet' | 'pnl';

export function AccountingSummary() {
  const [period, setPeriod] = useState<PeriodQuery>('week');
  const [activeTab, setActiveTab] = useState<SubTab>('balance-sheet');

  const { data: balanceSheet } = useBalanceSheet(period);
  const { data: pnl } = usePnl(period);
  const { refresh, isRefreshing, isRateLimited, retryAfter } = useRefreshAllPositions();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex gap-1">
          <TabButton
            label="Balance Sheet"
            active={activeTab === 'balance-sheet'}
            onClick={() => setActiveTab('balance-sheet')}
          />
          <TabButton
            label="P&L Statement"
            active={activeTab === 'pnl'}
            onClick={() => setActiveTab('pnl')}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refresh()}
            disabled={isRefreshing || isRateLimited}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              isRefreshing || isRateLimited
                ? 'text-slate-500 border-slate-700/30 cursor-not-allowed'
                : 'text-slate-300 border-slate-600 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {isRefreshing
              ? 'Refreshing...'
              : isRateLimited
                ? `Refresh (${retryAfter}s)`
                : 'Refresh'}
          </button>
          <AccountingPeriodSelector activePeriod={period} onPeriodChange={setPeriod} />
        </div>
      </div>

      {/* Date range display */}
      {pnl && (
        <p className="text-xs text-slate-500 -mt-4 text-right">
          {new Date(pnl.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' — '}
          {new Date(pnl.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
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
