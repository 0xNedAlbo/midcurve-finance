'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SlippageSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerLabel: string;
  exitSlippageBps: number;
  swapSlippageBps: number;
  swapEnabled: boolean;
  onExitSlippageChange: (bps: number) => void;
  onSwapSlippageChange: (bps: number) => void;
}

const EXIT_SLIPPAGE_OPTIONS = [
  { value: 50, label: '0.5%' },
  { value: 100, label: '1%' },
  { value: 200, label: '2%' },
  { value: 500, label: '5%' },
];

const SWAP_SLIPPAGE_OPTIONS = [
  { value: 100, label: '1%' },
  { value: 300, label: '3%' },
  { value: 500, label: '5%' },
  { value: 1000, label: '10%' },
];

export function SlippageSettingsModal({
  isOpen,
  onClose,
  triggerLabel,
  exitSlippageBps,
  swapSlippageBps,
  swapEnabled,
  onExitSlippageChange,
  onSwapSlippageChange,
}: SlippageSettingsModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-lg max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div>
              <h2 className="text-2xl font-bold text-white">Advanced Settings</h2>
              <p className="text-sm text-slate-400 mt-1">{triggerLabel}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)] space-y-5">
            {/* Exit Slippage Section */}
            <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600/50">
              <h3 className="text-sm font-semibold text-white mb-2">Exit Slippage</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                When your position is closed, liquidity is removed from the pool in a single
                transaction. During this brief window, the pool price may shift slightly due to
                other trades. This tolerance sets a buffer for how much the received token amounts
                may differ from the expected amounts. A higher value reduces the chance of the
                transaction reverting, while a lower value ensures you receive closer to the
                expected amounts.
              </p>
              <div className="flex gap-2">
                {EXIT_SLIPPAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onExitSlippageChange(option.value)}
                    className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                      exitSlippageBps === option.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-600/50 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Swap Price Protection Section */}
            {swapEnabled && (
              <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600/50">
                <h3 className="text-sm font-semibold text-white mb-2">Swap Price Protection</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  After your position is closed, the collected tokens can be swapped into a single
                  token. Before executing, the swap price is compared against the current fair
                  market value from CoinGecko. If the best available swap price falls below this
                  threshold, the order will not execute.
                </p>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  A stricter setting (lower %) protects you from swapping at an unfavorable
                  rate — but the order may not execute if market conditions are volatile, leaving
                  your position open and your risk exposure unchanged. A looser setting (higher %)
                  ensures the position is closed even during adverse conditions — removing your risk
                  exposure, but potentially locking in a loss that cannot be recovered.
                </p>
                <div className="flex gap-2">
                  {SWAP_SLIPPAGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => onSwapSlippageChange(option.value)}
                      className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                        swapSlippageBps === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-600/50 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-700/50">
            <button
              onClick={onClose}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
