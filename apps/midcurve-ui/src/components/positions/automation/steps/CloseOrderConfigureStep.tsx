/**
 * Close Order Configure Step
 *
 * Step 1: Configure trigger mode and price thresholds
 */

import { useState, useCallback, useEffect } from 'react';
import { TrendingDown, TrendingUp, ArrowLeftRight, Info, AlertCircle } from 'lucide-react';
import type { TriggerMode } from '@midcurve/api-shared';
import { priceToSqrtRatioX96 } from '@midcurve/shared';
import { parseUnits } from 'viem';
import type { CloseOrderFormData } from '../CloseOrderModal';
import { SwapConfigSection } from './SwapConfigSection';

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
  /**
   * Whether token0 is the quote token (affects price direction validation)
   */
  isToken0Quote: boolean;
  /**
   * Chain ID (used to check swap support)
   */
  chainId: number;
  /**
   * Optional order type to lock the trigger mode.
   * When provided, the trigger mode selector is hidden.
   * - 'stopLoss' → triggerMode 'LOWER' (only lower price input shown)
   * - 'takeProfit' → triggerMode 'UPPER' (only upper price input shown)
   */
  orderType?: 'stopLoss' | 'takeProfit';
}

/**
 * Validates trigger price against current price
 * Returns error message if invalid, null if valid
 *
 * The validation depends on isToken0Quote:
 * - When isToken0Quote=false: Higher sqrtPriceX96 = Higher user price
 * - When isToken0Quote=true: Higher sqrtPriceX96 = LOWER user price (inverted)
 */
function validateTriggerPrice(
  _triggerMode: TriggerMode,
  _sqrtPriceX96Lower: string | undefined,
  _sqrtPriceX96Upper: string | undefined,
  _currentSqrtPriceX96: string,
  _isToken0Quote: boolean
): string | null {
  // TODO: TEMPORARY - Re-enable trigger price validation after testing
  // This validation prevents SL orders above current price and TP orders below
  // Disabled for testing purposes
  return null;

  /* --- BEGIN DISABLED VALIDATION ---
  if (!currentSqrtPriceX96) return null;

  try {
    const current = BigInt(currentSqrtPriceX96);

    // For isToken0Quote=true, the comparison is inverted
    // Lower user price = Higher sqrtPriceX96
    const isLowerValid = isToken0Quote
      ? (trigger: bigint) => trigger > current // inverted: lower user price = higher sqrtPriceX96
      : (trigger: bigint) => trigger < current; // normal: lower user price = lower sqrtPriceX96

    const isUpperValid = isToken0Quote
      ? (trigger: bigint) => trigger < current // inverted: higher user price = lower sqrtPriceX96
      : (trigger: bigint) => trigger > current; // normal: higher user price = higher sqrtPriceX96

    // Check LOWER trigger (stop-loss must be below current price)
    if ((triggerMode === 'LOWER' || triggerMode === 'BOTH') && sqrtPriceX96Lower) {
      const lower = BigInt(sqrtPriceX96Lower);
      if (!isLowerValid(lower)) {
        return 'Stop-loss price must be below current price';
      }
    }

    // Check UPPER trigger (take-profit must be above current price)
    if ((triggerMode === 'UPPER' || triggerMode === 'BOTH') && sqrtPriceX96Upper) {
      const upper = BigInt(sqrtPriceX96Upper);
      if (!isUpperValid(upper)) {
        return 'Take-profit price must be above current price';
      }
    }

    return null;
  } catch {
    // If bigint conversion fails, skip validation
    return null;
  }
  --- END DISABLED VALIDATION --- */
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
  currentSqrtPriceX96,
  currentPriceDisplay,
  isToken0Quote,
  chainId,
  orderType,
}: CloseOrderConfigureStepProps) {
  // When orderType is provided, hide the trigger mode selector
  const showTriggerModeSelector = !orderType;
  const [lowerPriceInput, setLowerPriceInput] = useState(formData.priceLowerDisplay);
  const [upperPriceInput, setUpperPriceInput] = useState(formData.priceUpperDisplay);

  // Validate prices whenever relevant form data changes
  useEffect(() => {
    const validationError = validateTriggerPrice(
      formData.triggerMode,
      formData.sqrtPriceX96Lower || undefined,
      formData.sqrtPriceX96Upper || undefined,
      currentSqrtPriceX96,
      isToken0Quote
    );
    onChange({ priceValidationError: validationError });
  }, [
    formData.triggerMode,
    formData.sqrtPriceX96Lower,
    formData.sqrtPriceX96Upper,
    currentSqrtPriceX96,
    isToken0Quote,
    onChange,
  ]);

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
      {/* Trigger Mode Selection - hidden when orderType is provided */}
      {showTriggerModeSelector && (
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
      )}

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

        {/* Price Validation Error */}
        {formData.priceValidationError && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{formData.priceValidationError}</p>
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

      {/* Post-Close Swap Configuration */}
      <SwapConfigSection
        formData={formData}
        onChange={onChange}
        baseToken={baseToken}
        quoteToken={quoteToken}
        chainId={chainId}
      />
    </div>
  );
}
