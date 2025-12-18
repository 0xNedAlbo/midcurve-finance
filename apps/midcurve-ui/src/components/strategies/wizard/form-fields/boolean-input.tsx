"use client";

import type { ConstructorParamUI } from "@midcurve/shared";

interface BooleanInputProps {
  name: string;
  ui: ConstructorParamUI;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * Boolean input as a toggle switch
 */
export function BooleanInput({
  name,
  ui,
  value,
  onChange,
  error,
}: BooleanInputProps) {
  const isChecked = value === "true";
  const hasError = !!error;

  const handleToggle = () => {
    onChange(isChecked ? "false" : "true");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={name}
          className="block text-sm font-medium text-slate-300 cursor-pointer"
          onClick={handleToggle}
        >
          {ui.label}
        </label>

        {/* Toggle Switch */}
        <button
          id={name}
          type="button"
          role="switch"
          aria-checked={isChecked}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-slate-800 ${
            isChecked ? "bg-blue-600" : "bg-slate-600"
          } ${hasError ? "ring-2 ring-red-500/50" : ""}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              isChecked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {ui.description && !hasError && (
        <p className="text-slate-400 text-xs">{ui.description}</p>
      )}

      {hasError && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
