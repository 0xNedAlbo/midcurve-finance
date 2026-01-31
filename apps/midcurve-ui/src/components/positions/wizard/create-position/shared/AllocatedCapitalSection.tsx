import { formatUnits } from 'viem';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';

interface AllocatedCapitalSectionProps {
  allocatedBaseAmount: string;
  allocatedQuoteAmount: string;
  totalQuoteValue: string;
  baseToken: PoolSearchTokenInfo | null;
  quoteToken: PoolSearchTokenInfo | null;
}

/**
 * Format a bigint amount as a human-readable number
 */
function formatTokenAmount(rawAmount: string, decimals: number): string {
  try {
    const amount = BigInt(rawAmount);
    if (amount === 0n) return '0';

    const formatted = formatUnits(amount, decimals);
    const num = parseFloat(formatted);

    // Format based on magnitude
    if (num === 0) return '0';
    if (num < 0.0001) return '<0.0001';
    if (num < 1) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    if (num < 1000000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  } catch {
    return '0';
  }
}

export function AllocatedCapitalSection({
  allocatedBaseAmount,
  allocatedQuoteAmount,
  totalQuoteValue,
  baseToken,
  quoteToken,
}: AllocatedCapitalSectionProps) {
  // Show placeholder if no tokens or no allocation
  if (!baseToken || !quoteToken) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Allocated Capital</p>
        <p className="text-slate-500 text-sm">Select a pool first</p>
      </div>
    );
  }

  const hasAllocation =
    allocatedBaseAmount !== '0' ||
    allocatedQuoteAmount !== '0' ||
    totalQuoteValue !== '0';

  if (!hasAllocation) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Allocated Capital</p>
        <p className="text-slate-500 text-sm">Enter amounts to see allocation</p>
      </div>
    );
  }

  const baseFormatted = formatTokenAmount(allocatedBaseAmount, baseToken.decimals);
  const quoteFormatted = formatTokenAmount(allocatedQuoteAmount, quoteToken.decimals);
  const totalFormatted = formatTokenAmount(totalQuoteValue, quoteToken.decimals);

  return (
    <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
      <p className="text-xs text-slate-400">Allocated Capital</p>

      {/* Base amount */}
      <div className="flex justify-between items-center">
        <span className="text-slate-400 text-sm">{baseToken.symbol}</span>
        <span className="text-white font-medium text-sm">{baseFormatted}</span>
      </div>

      {/* Quote amount */}
      <div className="flex justify-between items-center">
        <span className="text-slate-400 text-sm">{quoteToken.symbol}</span>
        <span className="text-white font-medium text-sm">{quoteFormatted}</span>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-600/50" />

      {/* Total quote value */}
      <div className="flex justify-between items-center">
        <span className="text-slate-300 text-sm font-medium">Total Value</span>
        <span className="text-white font-bold text-sm">
          {totalFormatted} {quoteToken.symbol}
        </span>
      </div>
    </div>
  );
}
