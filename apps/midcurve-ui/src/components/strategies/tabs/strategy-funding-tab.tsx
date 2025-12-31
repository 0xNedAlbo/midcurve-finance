/**
 * Strategy Funding Tab
 *
 * Displays funding information for a strategy.
 * Currently a placeholder - to be implemented.
 */

import { Wallet } from "lucide-react";

export function StrategyFundingTab() {
  return (
    <div className="py-12">
      <div className="flex flex-col items-center justify-center text-center">
        <div className="p-4 bg-slate-700/30 rounded-full mb-4">
          <Wallet className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-medium text-white mb-2">Funding</h3>
        <p className="text-slate-400 max-w-md">
          Coming soon...
        </p>
      </div>
    </div>
  );
}
