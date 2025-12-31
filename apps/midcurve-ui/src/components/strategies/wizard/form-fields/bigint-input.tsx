"use client";

import type { ConstructorParamUI } from "@midcurve/shared";

interface BigIntInputProps {
  name: string;
  ui: ConstructorParamUI;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * BigInt input field for uint256, int256, and other integer types
 * Values are stored as strings to preserve precision
 */
export function BigIntInput({
  name,
  ui,
  value,
  onChange,
  error,
}: BigIntInputProps) {
  const isRequired = ui.required !== false;
  const hasError = !!error;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Allow empty string for clearing
    if (newValue === "") {
      onChange("");
      return;
    }

    // Only allow valid integer characters (digits and optional leading minus for signed types)
    // Remove any non-digit characters except leading minus
    const cleanValue = newValue.replace(/[^0-9-]/g, "");

    // Only allow one minus and only at the start
    const parts = cleanValue.split("-");
    if (parts.length > 2) return;
    if (parts.length === 2 && parts[0] !== "") return;

    onChange(cleanValue);
  };

  // Format display hint based on min/max
  const getHint = () => {
    const hints: string[] = [];
    if (ui.min !== undefined) hints.push(`Min: ${ui.min}`);
    if (ui.max !== undefined) hints.push(`Max: ${ui.max}`);
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
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        placeholder={ui.placeholder || "0"}
        className={`w-full px-4 py-3 bg-slate-700 border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 transition-colors font-mono ${
          hasError
            ? "border-red-500/50 focus:ring-red-500/50"
            : "border-slate-600 focus:ring-blue-500/50 hover:border-slate-500"
        }`}
      />

      <div className="flex justify-between text-xs">
        <span className="text-slate-400">
          {ui.description || "Enter a whole number"}
        </span>
        {hint && <span className="text-slate-500">{hint}</span>}
      </div>

      {hasError && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
