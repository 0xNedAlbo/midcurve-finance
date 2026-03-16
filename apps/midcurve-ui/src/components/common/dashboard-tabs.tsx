/**
 * DashboardTabs - Tab navigation for Dashboard
 *
 * Allows switching between "Positions" and "Hedged Positions" views.
 */

export type DashboardTab = 'positions' | 'accounting';

interface DashboardTabsProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

export function DashboardTabs({ activeTab, onTabChange }: DashboardTabsProps) {
  return (
    <div className="flex border-b border-slate-700/50 mb-6">
      <button
        onClick={() => onTabChange('positions')}
        className={`px-4 py-3 font-medium transition-colors cursor-pointer ${
          activeTab === 'positions'
            ? 'text-blue-400 border-b-2 border-blue-400 -mb-px'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        Positions
      </button>
      <button
        onClick={() => onTabChange('accounting')}
        className={`px-4 py-3 font-medium transition-colors cursor-pointer ${
          activeTab === 'accounting'
            ? 'text-blue-400 border-b-2 border-blue-400 -mb-px'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        Accounting
      </button>
    </div>
  );
}
