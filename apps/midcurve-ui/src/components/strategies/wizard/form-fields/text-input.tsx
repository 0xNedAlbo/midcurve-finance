"use client";

import type { ConstructorParamUI } from "@midcurve/shared";

interface TextInputProps {
  name: string;
  ui: ConstructorParamUI;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * Text input field for string and bytes32 constructor parameters
 */
export function TextInput({
  name,
  ui,
  value,
  onChange,
  error,
}: TextInputProps) {
  const isRequired = ui.required !== false;
  const hasError = !!error;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;

    // Apply pattern validation in real-time if provided
    if (ui.pattern && newValue) {
      const regex = new RegExp(ui.pattern);
      // Only update if matches pattern or is empty (allowing deletion)
      if (!regex.test(newValue) && newValue !== "") {
        return;
      }
    }

    onChange(newValue);
  };

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
        value={value}
        onChange={handleChange}
        placeholder={ui.placeholder}
        className={`w-full px-4 py-3 bg-slate-700 border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 transition-colors ${
          hasError
            ? "border-red-500/50 focus:ring-red-500/50"
            : "border-slate-600 focus:ring-blue-500/50 hover:border-slate-500"
        }`}
      />

      {ui.description && !hasError && (
        <p className="text-slate-400 text-xs">{ui.description}</p>
      )}

      {hasError && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
