/**
 * Hedge Button
 *
 * Action button for creating a hedged position (Hedge Vault) from an existing
 * Uniswap V3 position. Opens the CreateHedgedPositionModal when clicked.
 */

'use client';

import { Shield } from 'lucide-react';

interface HedgeButtonProps {
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function HedgeButton({ onClick, disabled = false, disabledReason }: HedgeButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
        disabled
          ? 'text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed'
          : 'text-violet-300 bg-violet-900/20 hover:bg-violet-800/30 border-violet-600/50 cursor-pointer'
      }`}
    >
      <Shield className="w-3 h-3" />
      Hedge
    </button>
  );
}
