/**
 * DashboardTabs - Tab navigation for Dashboard
 *
 * Allows switching between "Positions" and "Strategies" views.
 */

interface DashboardTabsProps {
  activeTab: 'positions' | 'strategies';
  onTabChange: (tab: 'positions' | 'strategies') => void;
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
      {/* TODO: Re-enable Strategies tab when strategy feature is ready
      <button
        onClick={() => onTabChange('strategies')}
        className={`px-4 py-3 font-medium transition-colors cursor-pointer ${
          activeTab === 'strategies'
            ? 'text-blue-400 border-b-2 border-blue-400 -mb-px'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        Strategies
      </button>
      */}
    </div>
  );
}
