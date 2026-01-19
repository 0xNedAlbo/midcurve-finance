'use client';

/**
 * VaultConfigStep - Step 1 of Hedge Vault creation wizard
 *
 * Collects vault token name and symbol from the user, with smart defaults
 * based on the position's base and quote tokens.
 *
 * Advanced options (collapsible):
 * - Loss cap percentage (5%-50%, default 10%)
 * - Reopen cooldown blocks (10-1000, default 100)
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';

interface VaultConfigStepProps {
  vaultName: string;
  vaultSymbol: string;
  lossCapBps: number;
  reopenCooldownBlocks: number;
  onVaultNameChange: (name: string) => void;
  onVaultSymbolChange: (symbol: string) => void;
  onLossCapChange: (bps: number) => void;
  onCooldownChange: (blocks: number) => void;
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  nftId: number;
}

// Approximate block times by chain (could be extended)
const BLOCK_TIME_SECONDS = 12; // Ethereum mainnet average

export function VaultConfigStep({
  vaultName,
  vaultSymbol,
  lossCapBps,
  reopenCooldownBlocks,
  onVaultNameChange,
  onVaultSymbolChange,
  onLossCapChange,
  onCooldownChange,
  baseTokenSymbol,
  quoteTokenSymbol,
  nftId,
}: VaultConfigStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Suggested defaults
  const suggestedName = `Hedged Position #${nftId}`;
  const suggestedSymbol = `HEDGE${nftId}`;

  // Convert loss cap bps to percentage for display
  const lossCapPercent = lossCapBps / 100;

  // Approximate cooldown time
  const cooldownMinutes = Math.round(
    (reopenCooldownBlocks * BLOCK_TIME_SECONDS) / 60
  );

  return (
    <div className="space-y-6">
      {/* Vault Token Name */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">
          Vault Token Name
        </label>
        <input
          type="text"
          value={vaultName}
          onChange={(e) => onVaultNameChange(e.target.value)}
          placeholder={suggestedName}
          className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50"
        />
        {!vaultName && (
          <button
            onClick={() => onVaultNameChange(suggestedName)}
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
          >
            Use suggested: {suggestedName}
          </button>
        )}
      </div>

      {/* Vault Token Symbol */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">
          Vault Token Symbol
        </label>
        <input
          type="text"
          value={vaultSymbol}
          onChange={(e) => onVaultSymbolChange(e.target.value.toUpperCase())}
          placeholder={suggestedSymbol}
          maxLength={11}
          className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 uppercase"
        />
        {!vaultSymbol && (
          <button
            onClick={() => onVaultSymbolChange(suggestedSymbol)}
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
          >
            Use suggested: {suggestedSymbol}
          </button>
        )}
      </div>

      {/* Position Info (read-only display) */}
      <div className="p-4 bg-slate-700/30 border border-slate-600/30 rounded-lg">
        <div className="text-sm text-slate-400 mb-2">Position Details</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500">Pool:</span>{' '}
            <span className="text-white">
              {baseTokenSymbol}/{quoteTokenSymbol}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Deposit Mode:</span>{' '}
            <span className="text-amber-400">Closed</span>
          </div>
        </div>
      </div>

      {/* Advanced Options (Collapsible) */}
      <div className="border border-slate-600/50 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors cursor-pointer"
        >
          <span className="text-sm font-medium text-slate-300">
            Advanced Options
          </span>
          {showAdvanced ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showAdvanced && (
          <div className="p-4 space-y-6 border-t border-slate-600/50">
            {/* Loss Cap Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    Loss Cap
                  </label>
                  <div className="group relative">
                    <Info className="w-4 h-4 text-slate-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-xs text-slate-300 w-64 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      Maximum loss allowed before the vault automatically
                      triggers a close. Set as a percentage of position value.
                    </div>
                  </div>
                </div>
                <span className="text-sm font-mono text-white">
                  {lossCapPercent}%
                </span>
              </div>
              <input
                type="range"
                min={500}
                max={5000}
                step={100}
                value={lossCapBps}
                onChange={(e) => onLossCapChange(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>5%</span>
                <span>50%</span>
              </div>
            </div>

            {/* Cooldown Blocks Input */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    Reopen Cooldown
                  </label>
                  <div className="group relative">
                    <Info className="w-4 h-4 text-slate-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-xs text-slate-300 w-64 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      Number of blocks to wait before the position can be
                      reopened after a trigger. Prevents rapid open/close cycles.
                    </div>
                  </div>
                </div>
                <span className="text-sm text-slate-400">
                  ~{cooldownMinutes} min
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={reopenCooldownBlocks}
                  onChange={(e) =>
                    onCooldownChange(
                      Math.max(10, Math.min(1000, Number(e.target.value)))
                    )
                  }
                  className="w-32 px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50"
                />
                <span className="text-sm text-slate-500">blocks</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Min: 10 blocks</span>
                <span>Max: 1000 blocks</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
