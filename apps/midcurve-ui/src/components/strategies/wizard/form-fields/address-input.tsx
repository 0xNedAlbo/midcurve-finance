"use client";

import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import type { ConstructorParamUI } from "@midcurve/shared";

interface AddressInputProps {
  name: string;
  ui: ConstructorParamUI;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * EVM address input with EIP-55 checksum validation
 */
export function AddressInput({
  name,
  ui,
  value,
  onChange,
  error,
}: AddressInputProps) {
  const isRequired = ui.required !== false;
  const hasError = !!error;
  const [isValidFormat, setIsValidFormat] = useState<boolean | null>(null);

  // Validate address format
  useEffect(() => {
    if (!value) {
      setIsValidFormat(null);
      return;
    }

    // Basic format check: 0x followed by 40 hex characters
    const isValid = /^0x[a-fA-F0-9]{40}$/.test(value);
    setIsValidFormat(isValid);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;

    // Auto-add 0x prefix if user starts typing hex
    if (
      newValue.length === 1 &&
      /^[a-fA-F0-9]$/.test(newValue) &&
      !value.startsWith("0x")
    ) {
      newValue = "0x" + newValue;
    }

    // Only allow hex characters after 0x
    if (newValue.length > 2) {
      const prefix = newValue.slice(0, 2);
      const rest = newValue.slice(2);
      if (prefix === "0x" || prefix === "0X") {
        newValue = "0x" + rest.replace(/[^a-fA-F0-9]/g, "");
      }
    }

    // Limit to 42 characters (0x + 40 hex)
    if (newValue.length > 42) {
      newValue = newValue.slice(0, 42);
    }

    onChange(newValue);
  };

  // Show validation indicator
  const showValidIndicator = value && value.length === 42;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className="block text-sm font-medium text-slate-300"
      >
        {ui.label}
        {isRequired && <span className="text-red-400 ml-1">*</span>}
      </label>

      <div className="relative">
        <input
          id={name}
          type="text"
          value={value}
          onChange={handleChange}
          placeholder={ui.placeholder || "0x..."}
          className={`w-full px-4 py-3 pr-10 bg-slate-700 border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 transition-colors font-mono text-sm ${
            hasError || (showValidIndicator && !isValidFormat)
              ? "border-red-500/50 focus:ring-red-500/50"
              : isValidFormat
              ? "border-green-500/50 focus:ring-green-500/50"
              : "border-slate-600 focus:ring-blue-500/50 hover:border-slate-500"
          }`}
        />

        {/* Validation indicator */}
        {showValidIndicator && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {isValidFormat ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400" />
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-slate-400">
          {ui.description || "Enter an EVM address"}
        </span>
        <span className="text-slate-500 font-mono">
          {value.length}/42
        </span>
      </div>

      {hasError && <p className="text-red-400 text-xs">{error}</p>}
      {!hasError && showValidIndicator && !isValidFormat && (
        <p className="text-red-400 text-xs">Invalid address format</p>
      )}
    </div>
  );
}
