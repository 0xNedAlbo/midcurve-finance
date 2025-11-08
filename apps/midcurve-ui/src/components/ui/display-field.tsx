"use client";

interface DisplayFieldProps {
  label: string;
  value: string;
}

/**
 * DisplayField Component
 *
 * Displays a read-only technical value without copy functionality.
 * Used for derived or non-technical data that doesn't need to be copied.
 *
 * Features:
 * - Monospace font for consistency with CopyableField
 * - Glassmorphic dark theme styling
 * - Read-only display (no interactivity)
 */
export function DisplayField({ label, value }: DisplayFieldProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-300">{label}</div>
      <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <span className="font-mono text-sm text-white">{value}</span>
      </div>
    </div>
  );
}
