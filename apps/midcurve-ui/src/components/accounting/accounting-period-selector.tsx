/**
 * AccountingPeriodSelector - Pill buttons for selecting P&L reporting period
 */

import type { PeriodQuery } from '@midcurve/api-shared';

const periods: { value: PeriodQuery; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

interface AccountingPeriodSelectorProps {
  activePeriod: PeriodQuery;
  onPeriodChange: (period: PeriodQuery) => void;
}

export function AccountingPeriodSelector({
  activePeriod,
  onPeriodChange,
}: AccountingPeriodSelectorProps) {
  return (
    <div className="flex gap-2">
      {periods.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onPeriodChange(value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors cursor-pointer ${
            activePeriod === value
              ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
              : 'text-slate-400 border-slate-700/50 hover:text-slate-200 hover:border-slate-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
