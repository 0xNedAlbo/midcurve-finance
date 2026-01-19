/**
 * Slippage Settings Component
 *
 * Collapsible settings panel for configuring slippage tolerance.
 * Provides presets and custom input.
 */

'use client';

import { useState } from 'react';

interface SlippageSettingsProps {
  slippageBps: number;
  onSlippageChange: (slippageBps: number) => void;
}

const SLIPPAGE_PRESETS = [
  { label: '0.5%', value: 50 },
  { label: '1%', value: 100 },
  { label: '3%', value: 300 },
];

/**
 * Slippage settings with presets and custom input
 */
export function SlippageSettings({
  slippageBps,
  onSlippageChange,
}: SlippageSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const slippagePercent = slippageBps / 100;
  const isHighSlippage = slippageBps > 300; // > 3%

  const handlePresetClick = (value: number) => {
    setIsCustom(false);
    setCustomInput('');
    onSlippageChange(value);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomInput(value);

    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0.01 && numValue <= 50) {
      setIsCustom(true);
      onSlippageChange(Math.round(numValue * 100));
    }
  };

  return (
    <div className="mb-4">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
      >
        <span>Advanced Settings</span>
        <div className="flex items-center gap-2">
          <span className={isHighSlippage ? 'text-amber-400' : 'text-slate-300'}>
            Slippage: {slippagePercent}%
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Settings */}
      {isOpen && (
        <div className="mt-3 p-3 bg-slate-900/30 rounded-lg">
          <div className="text-sm text-slate-400 mb-2">Slippage Tolerance</div>

          {/* Presets */}
          <div className="flex gap-2 mb-3">
            {SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handlePresetClick(preset.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  !isCustom && slippageBps === preset.value
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom Input */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={customInput}
              onChange={handleCustomChange}
              placeholder="Custom"
              min="0.01"
              max="50"
              step="0.1"
              className={`w-24 bg-slate-900/50 border rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none ${
                isCustom ? 'border-amber-500' : 'border-slate-600 focus:border-amber-500'
              }`}
            />
            <span className="text-slate-400">%</span>
          </div>

          {/* High Slippage Warning */}
          {isHighSlippage && (
            <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-400">
              Warning: High slippage may result in significant price difference.
            </div>
          )}

          {/* Help Text */}
          <p className="mt-2 text-xs text-slate-500">
            Your transaction will revert if the price changes unfavorably by more than this percentage.
          </p>
        </div>
      )}
    </div>
  );
}
