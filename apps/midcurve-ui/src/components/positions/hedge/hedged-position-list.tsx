/**
 * HedgedPositionList - Placeholder for hedged positions list
 *
 * Will display a list of positions that have been converted to Hedge Vaults
 * with SIL/TIP protection.
 */

import { Shield } from 'lucide-react';

export function HedgedPositionList() {
  return (
    <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-12">
      <div className="flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-violet-900/30 rounded-full flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-violet-400" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          No Hedged Positions Yet
        </h3>
        <p className="text-slate-400 max-w-md">
          Hedged positions are Uniswap V3 positions protected by automatic SIL
          (Stop Impermanent Loss) and TIP (Take Impermanent Profit) triggers.
          Convert an existing position to get started.
        </p>
      </div>
    </div>
  );
}
