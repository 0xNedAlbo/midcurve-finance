/**
 * InfoRow - Simple label-value display row
 *
 * Used in modals and detail views to display position information
 * in a consistent format.
 */

interface InfoRowProps {
  label: string;
  value: string | number | React.ReactNode;
  valueClassName?: string;
}

export function InfoRow({ label, value, valueClassName }: InfoRowProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-400">{label}:</span>
      <span className={valueClassName || "text-sm text-white font-mono"}>
        {value}
      </span>
    </div>
  );
}
