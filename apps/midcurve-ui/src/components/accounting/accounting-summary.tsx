/**
 * AccountingSummary - Main container for the Summary tab
 *
 * Owns period state and fetches accounting data via hooks.
 */

import { useState } from 'react';
import type { PeriodQuery } from '@midcurve/api-shared';
import { useBalanceSheet } from '@/hooks/accounting/useBalanceSheet';
import { usePnl } from '@/hooks/accounting/usePnl';
import { usePeriodComparison } from '@/hooks/accounting/usePeriodComparison';
import { useNavTimeline } from '@/hooks/accounting/useNavTimeline';
import { AccountingPeriodSelector } from './accounting-period-selector';
import { AccountingSummaryCards } from './accounting-summary-cards';
import { NavChart } from './nav-chart';
import { PnlPositionTable } from './pnl-position-table';

export function AccountingSummary() {
  const [period, setPeriod] = useState<PeriodQuery>('month');

  const { data: balanceSheet } = useBalanceSheet();
  const { data: pnl } = usePnl(period);
  const { data: periodComparison } = usePeriodComparison(period);
  const { data: navTimeline } = useNavTimeline(90);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Portfolio Summary</h2>
          <p className="text-slate-300">P&L and NAV overview for tracked positions</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AccountingPeriodSelector activePeriod={period} onPeriodChange={setPeriod} />
          {pnl && (
            <p className="text-xs text-slate-500">
              {new Date(pnl.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' — '}
              {new Date(pnl.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      </div>

      <AccountingSummaryCards
        balanceSheet={balanceSheet}
        pnl={pnl}
        periodComparison={periodComparison}
      />

      <NavChart data={navTimeline} />

      <PnlPositionTable instruments={pnl?.instruments} />
    </div>
  );
}
