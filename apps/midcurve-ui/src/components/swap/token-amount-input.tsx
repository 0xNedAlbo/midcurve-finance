/**
 * TokenAmountInput Component
 *
 * Amount input field with balance display and MAX button.
 * Used in the free-form swap widget for entering swap amounts.
 */

'use client';

import { formatUnits } from 'viem';
import type { SwapToken } from '@midcurve/api-shared';

export interface TokenAmountInputProps {
  value: string;
  onChange: (value: string) => void;
  token: SwapToken | null;
  label: string;
  balance?: bigint;
  decimals?: number;
  disabled?: boolean;
  showMaxButton?: boolean;
  onMaxClick?: () => void;
  readOnly?: boolean;
}

/**
 * Format a bigint balance for display
 */
function formatBalance(balance: bigint, decimals: number): string {
  const formatted = formatUnits(balance, decimals);
  const num = parseFloat(formatted);

  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
  return `${(num / 1000000).toFixed(2)}M`;
}

/**
 * Token Amount Input - Amount field with balance display
 *
 * Features:
 * - Numeric input with decimal support
 * - Balance display when token is selected
 * - MAX button to fill with full balance
 * - Read-only mode for displaying calculated amounts
 */
export function TokenAmountInput({
  value,
  onChange,
  token,
  label,
  balance,
  decimals,
  disabled = false,
  showMaxButton = false,
  onMaxClick,
  readOnly = false,
}: TokenAmountInputProps) {
  const effectiveDecimals = decimals ?? token?.decimals ?? 18;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // Allow empty string
    if (inputValue === '') {
      onChange('');
      return;
    }

    // Allow only valid numeric input with decimals
    const regex = new RegExp(`^\\d*\\.?\\d{0,${effectiveDecimals}}$`);
    if (regex.test(inputValue)) {
      onChange(inputValue);
    }
  };

  const handleMaxClick = () => {
    if (onMaxClick) {
      onMaxClick();
    } else if (balance !== undefined && effectiveDecimals !== undefined) {
      const maxValue = formatUnits(balance, effectiveDecimals);
      onChange(maxValue);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        {token && balance !== undefined && (
          <span className="text-xs text-slate-400">
            Balance: {formatBalance(balance, effectiveDecimals)} {token.symbol}
          </span>
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          disabled={disabled || !token}
          readOnly={readOnly}
          placeholder={token ? '0.0' : 'Select a token'}
          className={`
            w-full px-4 py-3 pr-20
            bg-slate-700/50 border border-slate-600/50 rounded-lg
            text-white text-lg font-mono
            placeholder:text-slate-500
            focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50
            disabled:opacity-50 disabled:cursor-not-allowed
            ${readOnly ? 'cursor-default' : ''}
          `}
        />

        {showMaxButton && token && balance !== undefined && balance > 0n && !readOnly && (
          <button
            type="button"
            onClick={handleMaxClick}
            disabled={disabled}
            className="
              absolute right-3 top-1/2 -translate-y-1/2
              px-2 py-1 text-xs font-medium
              text-amber-400 hover:text-amber-300
              bg-amber-500/10 hover:bg-amber-500/20
              rounded transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              cursor-pointer
            "
          >
            MAX
          </button>
        )}
      </div>
    </div>
  );
}
