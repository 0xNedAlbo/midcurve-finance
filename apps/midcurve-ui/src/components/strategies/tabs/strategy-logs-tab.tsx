/**
 * Strategy Logs Tab
 *
 * Displays logs and activity history for a strategy.
 * Currently a placeholder - to be implemented.
 */

import { ScrollText } from "lucide-react";

export function StrategyLogsTab() {
  return (
    <div className="py-12">
      <div className="flex flex-col items-center justify-center text-center">
        <div className="p-4 bg-slate-700/30 rounded-full mb-4">
          <ScrollText className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-medium text-white mb-2">Logs</h3>
        <p className="text-slate-400 max-w-md">
          Coming soon...
        </p>
      </div>
    </div>
  );
}
