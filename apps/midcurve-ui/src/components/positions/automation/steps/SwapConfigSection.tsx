/**
 * Swap Config Section
 *
 * Optional section in close order configuration for post-close swap.
 * Allows user to swap all withdrawn assets into a single token via Paraswap.
 */

import { Info, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import type { CloseOrderFormData, SwapDirection } from '../CloseOrderModal';

// Chains supported for Paraswap swap integration
const PARASWAP_SUPPORTED_CHAINS = [1, 42161, 8453, 10] as const; // Ethereum, Arbitrum, Base, Optimism

const SWAP_SLIPPAGE_OPTIONS = [
  { value: 50, label: '0.5%' },
  { value: 100, label: '1%' },
  { value: 200, label: '2%' },
  { value: 300, label: '3%' },
  { value: 500, label: '5%' },
];

interface SwapConfigSectionProps {
  formData: CloseOrderFormData;
  onChange: (updates: Partial<CloseOrderFormData>) => void;
  baseToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  quoteToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  chainId: number;
}

export function SwapConfigSection({
  formData,
  onChange,
  baseToken,
  quoteToken,
  chainId,
}: SwapConfigSectionProps) {
  // Check if chain supports Paraswap
  const isChainSupported = PARASWAP_SUPPORTED_CHAINS.includes(
    chainId as (typeof PARASWAP_SUPPORTED_CHAINS)[number]
  );

  // If chain doesn't support swap, don't show the section
  if (!isChainSupported) {
    return null;
  }

  const handleToggleSwap = () => {
    onChange({ swapEnabled: !formData.swapEnabled });
  };

  const handleDirectionChange = (direction: SwapDirection) => {
    onChange({ swapDirection: direction });
  };

  const handleSlippageChange = (slippageBps: number) => {
    onChange({ swapSlippageBps: slippageBps });
  };

  // Determine token labels based on direction
  const getDirectionLabel = (direction: SwapDirection): string => {
    if (direction === 'BASE_TO_QUOTE') {
      return `Swap all ${baseToken.symbol} to ${quoteToken.symbol}`;
    } else {
      return `Swap all ${quoteToken.symbol} to ${baseToken.symbol}`;
    }
  };

  return (
    <div className="border-t border-slate-700/50 pt-4 mt-4">
      {/* Section Header with Toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">Post-Close Swap</span>
        </div>
        <button
          type="button"
          onClick={handleToggleSwap}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
            formData.swapEnabled ? 'bg-blue-600' : 'bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              formData.swapEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 mb-4">
        Automatically swap all withdrawn assets into a single token after closing
      </p>

      {/* Swap Options (only shown when enabled) */}
      {formData.swapEnabled && (
        <div className="space-y-4">
          {/* Direction Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Swap Direction</label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleDirectionChange('BASE_TO_QUOTE')}
                className={`w-full p-3 rounded-lg border transition-all cursor-pointer text-left ${
                  formData.swapDirection === 'BASE_TO_QUOTE'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-600 hover:border-slate-500'
                }`}
              >
                <span
                  className={`text-sm ${
                    formData.swapDirection === 'BASE_TO_QUOTE'
                      ? 'text-blue-400'
                      : 'text-slate-300'
                  }`}
                >
                  {getDirectionLabel('BASE_TO_QUOTE')}
                </span>
                <p className="text-xs text-slate-500 mt-1">
                  Receive all proceeds in {quoteToken.symbol}
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleDirectionChange('QUOTE_TO_BASE')}
                className={`w-full p-3 rounded-lg border transition-all cursor-pointer text-left ${
                  formData.swapDirection === 'QUOTE_TO_BASE'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-600 hover:border-slate-500'
                }`}
              >
                <span
                  className={`text-sm ${
                    formData.swapDirection === 'QUOTE_TO_BASE'
                      ? 'text-blue-400'
                      : 'text-slate-300'
                  }`}
                >
                  {getDirectionLabel('QUOTE_TO_BASE')}
                </span>
                <p className="text-xs text-slate-500 mt-1">
                  Receive all proceeds in {baseToken.symbol}
                </p>
              </button>
            </div>
          </div>

          {/* Swap Slippage */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Swap Slippage</label>
            <div className="flex gap-2 flex-wrap">
              {SWAP_SLIPPAGE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleSlippageChange(value)}
                  className={`py-2 px-3 text-sm rounded-lg border transition-colors cursor-pointer ${
                    formData.swapSlippageBps === value
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* High Slippage Warning */}
          {formData.swapSlippageBps > 300 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-yellow-300">
                High slippage tolerance may result in unfavorable swap rates. Only use higher
                values for volatile tokens or low liquidity pairs.
              </p>
            </div>
          )}

          {/* Info Note */}
          <div className="flex items-start gap-2 p-3 bg-slate-700/30 border border-slate-600/50 rounded-lg">
            <Info className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-400">
              The swap executes at trigger time using live market rates via Paraswap. Current prices
              shown are estimates only.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
