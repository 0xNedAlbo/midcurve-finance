"use client";

import type { ConstructorParamUI } from "@midcurve/shared";

interface NumberInputProps {
  name: string;
  ui: ConstructorParamUI;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * Number input field for decimal values (percentages, amounts with decimals)
 *
 * This component handles decimal input for values that are stored as integers
 * in the contract. For example, 5.5% with decimals=2 is stored as "550".
 *
 * The UI displays the decimal value, but onChange returns the integer string.
 */
export function NumberInput({
  name,
  ui,
  value,
  onChange,
  error,
}: NumberInputProps) {
  const isRequired = ui.required !== false;
  const hasError = !!error;
  const decimals = ui.decimals ?? 0;
  const step = ui.step ?? (decimals > 0 ? (1 / Math.pow(10, decimals)).toString() : "1");

  // Convert stored integer value to display decimal
  const getDisplayValue = (intValue: string): string => {
    if (!intValue || intValue === "") return "";
    if (decimals === 0) return intValue;

    try {
      const num = BigInt(intValue);
      const divisor = BigInt(Math.pow(10, decimals));
      const intPart = num / divisor;
      const fracPart = num % divisor;

      if (fracPart === BigInt(0)) {
        return intPart.toString();
      }

      // Pad fractional part with leading zeros if needed
      const fracStr = fracPart.toString().padStart(decimals, "0");
      // Remove trailing zeros
      const trimmedFrac = fracStr.replace(/0+$/, "");
      return `${intPart}.${trimmedFrac}`;
    } catch {
      return intValue;
    }
  };

  // Convert display decimal to storage integer
  const toStorageValue = (displayValue: string): string => {
    if (!displayValue || displayValue === "") return "";
    if (decimals === 0) return displayValue.replace(/[^0-9-]/g, "");

    try {
      // Parse the decimal number
      const parts = displayValue.split(".");
      const intPart = parts[0] || "0";
      let fracPart = parts[1] || "";

      // Pad or truncate fractional part to match decimals
      if (fracPart.length < decimals) {
        fracPart = fracPart.padEnd(decimals, "0");
      } else if (fracPart.length > decimals) {
        fracPart = fracPart.slice(0, decimals);
      }

      // Combine and parse as BigInt
      const isNegative = intPart.startsWith("-");
      const absInt = intPart.replace("-", "");
      const combined = absInt + fracPart;
      const result = BigInt(combined);

      return (isNegative ? -result : result).toString();
    } catch {
      return "";
    }
  };

  const displayValue = getDisplayValue(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // Allow empty
    if (inputValue === "") {
      onChange("");
      return;
    }

    // Validate decimal format
    const decimalRegex = /^-?\d*\.?\d*$/;
    if (!decimalRegex.test(inputValue)) {
      return;
    }

    // Convert to storage format
    onChange(toStorageValue(inputValue));
  };

  // Format display hint based on min/max
  const getHint = () => {
    const hints: string[] = [];
    if (ui.min !== undefined) {
      hints.push(`Min: ${getDisplayValue(ui.min)}`);
    }
    if (ui.max !== undefined) {
      hints.push(`Max: ${getDisplayValue(ui.max)}`);
    }
    return hints.length > 0 ? hints.join(" • ") : null;
  };

  const hint = getHint();

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className="block text-sm font-medium text-slate-300"
      >
        {ui.label}
        {isRequired && <span className="text-red-400 ml-1">*</span>}
      </label>

      <input
        id={name}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        placeholder={ui.placeholder || "0"}
        step={step}
        className={`w-full px-4 py-3 bg-slate-700 border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 transition-colors ${
          hasError
            ? "border-red-500/50 focus:ring-red-500/50"
            : "border-slate-600 focus:ring-blue-500/50 hover:border-slate-500"
        }`}
      />

      <div className="flex justify-between text-xs">
        <span className="text-slate-400">
          {ui.description || "Enter a number"}
        </span>
        {hint && <span className="text-slate-500">{hint}</span>}
      </div>

      {hasError && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
