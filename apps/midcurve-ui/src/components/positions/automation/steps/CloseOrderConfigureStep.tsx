/**
 * Close Order Configure Step
 *
 * Step 1: Configure trigger mode and price thresholds
 */

import { useState, useCallback } from 'react';
import { TrendingDown, TrendingUp, ArrowLeftRight, Info } from 'lucide-react';
import type { TriggerMode } from '@midcurve/api-shared';
import { priceToSqrtRatioX96 } from '@midcurve/shared';
import { parseUnits } from 'viem';
import type { CloseOrderFormData } from '../CloseOrderModal';

interface CloseOrderConfigureStepProps {
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
  currentSqrtPriceX96: string;
  currentPriceDisplay: string;
}

const TRIGGER_MODES: { value: TriggerMode; label: string; description: string; icon: typeof TrendingDown }[] = [
  {
    value: 'LOWER',
    label: 'Stop-Loss',
    description: 'Close when price falls below threshold',
    icon: TrendingDown,
  },
  {
    value: 'UPPER',
    label: 'Take-Profit',
    description: 'Close when price rises above threshold',
    icon: TrendingUp,
  },
  {
    value: 'BOTH',
    label: 'Range Exit',
    description: 'Close when price exits the range',
    icon: ArrowLeftRight,
  },
];

const SLIPPAGE_OPTIONS = [
  { value: 50, label: '0.5%' },
  { value: 100, label: '1%' },
  { value: 200, label: '2%' },
  { value: 500, label: '5%' },
];

const EXPIRATION_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export function CloseOrderConfigureStep({
  formData,
  onChange,
  baseToken,
  quoteToken,
  currentSqrtPriceX96: _currentSqrtPriceX96,
  currentPriceDisplay,
}: CloseOrderConfigureStepProps) {
  const [lowerPriceInput, setLowerPriceInput] = useState(formData.priceLowerDisplay);
  const [upperPriceInput, setUpperPriceInput] = useState(formData.priceUpperDisplay);

  // Convert price input to sqrtPriceX96
  const convertToSqrtPrice = useCallback(
    (priceStr: string): string | null => {
      if (!priceStr || isNaN(parseFloat(priceStr))) return null;

      try {
        // Parse the price to bigint with quote token decimals
        const priceBigInt = parseUnits(priceStr, quoteToken.decimals);

        // Convert to sqrtPriceX96
        const sqrtRatioX96 = priceToSqrtRatioX96(
          baseToken.address,
          quoteToken.address,
          baseToken.decimals,
          priceBigInt
        );

        return sqrtRatioX96.toString();
      } catch (err) {
        console.error('Failed to convert price:', err);
        return null;
      }
    },
    [baseToken, quoteToken]
  );

  // Handle lower price change
  const handleLowerPriceChange = useCallback(
    (value: string) => {
      setLowerPriceInput(value);
      const sqrtPrice = convertToSqrtPrice(value);
      onChange({
        priceLowerDisplay: value,
        sqrtPriceX96Lower: sqrtPrice || '',
      });
    },
    [convertToSqrtPrice, onChange]
  );

  // Handle upper price change
  const handleUpperPriceChange = useCallback(
    (value: string) => {
      setUpperPriceInput(value);
      const sqrtPrice = convertToSqrtPrice(value);
      onChange({
        priceUpperDisplay: value,
        sqrtPriceX96Upper: sqrtPrice || '',
      });
    },
    [convertToSqrtPrice, onChange]
  );

  return (
    <div className="space-y-6">
      {/* Trigger Mode Selection */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-3">Trigger Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {TRIGGER_MODES.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              onClick={() => onChange({ triggerMode: value })}
              className={`p-3 rounded-lg border transition-all cursor-pointer text-left ${
                formData.triggerMode === value
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-600 hover:border-slate-500'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon
                  className={`w-4 h-4 ${
                    formData.triggerMode === value ? 'text-blue-400' : 'text-slate-400'
                  }`}
                />
                <span
                  className={`text-sm font-medium ${
                    formData.triggerMode === value ? 'text-blue-400' : 'text-slate-300'
                  }`}
                >
                  {label}
                </span>
              </div>
              <p className="text-xs text-slate-500">{description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Current Price Display */}
      <div className="bg-slate-700/30 rounded-lg p-4">
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-400">Current Price:</span>
          <span className="font-mono text-slate-200">
            {currentPriceDisplay} {quoteToken.symbol}/{baseToken.symbol}
          </span>
        </div>
      </div>

      {/* Price Inputs */}
      <div className="space-y-4">
        {(formData.triggerMode === 'LOWER' || formData.triggerMode === 'BOTH') && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Lower Trigger Price ({quoteToken.symbol})
            </label>
            <div className="relative">
              <input
                type="text"
                value={lowerPriceInput}
                onChange={(e) => handleLowerPriceChange(e.target.value)}
                placeholder="Enter price..."
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {quoteToken.symbol}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Position closes when price falls below this level
            </p>
          </div>
        )}

        {(formData.triggerMode === 'UPPER' || formData.triggerMode === 'BOTH') && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Upper Trigger Price ({quoteToken.symbol})
            </label>
            <div className="relative">
              <input
                type="text"
                value={upperPriceInput}
                onChange={(e) => handleUpperPriceChange(e.target.value)}
                placeholder="Enter price..."
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {quoteToken.symbol}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Position closes when price rises above this level
            </p>
          </div>
        )}
      </div>

      {/* Advanced Settings */}
      <div className="space-y-4">
        {/* Slippage */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Slippage Tolerance</label>
          <div className="flex gap-2">
            {SLIPPAGE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onChange({ slippageBps: value })}
                className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors cursor-pointer ${
                  formData.slippageBps === value
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Expiration */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Valid Until</label>
          <div className="flex gap-2">
            {EXPIRATION_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onChange({ validUntilDays: value })}
                className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors cursor-pointer ${
                  formData.validUntilDays === value
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Info Note */}
      <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-300">
          When the price reaches your trigger level, your position will be automatically closed and
          funds sent to your wallet.
        </p>
      </div>
    </div>
  );
}
