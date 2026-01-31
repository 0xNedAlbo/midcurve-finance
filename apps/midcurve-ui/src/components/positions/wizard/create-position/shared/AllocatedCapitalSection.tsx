import { Coins } from 'lucide-react';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import { formatCompactValue } from '@midcurve/shared';

interface AllocatedCapitalSectionProps {
  allocatedBaseAmount: string;
  allocatedQuoteAmount: string;
  totalQuoteValue: string;
  baseToken: PoolSearchTokenInfo | null;
  quoteToken: PoolSearchTokenInfo | null;
  baseLogoUrl?: string | null;
  quoteLogoUrl?: string | null;
}

/**
 * Format a bigint amount (as string) as a human-readable number
 */
function formatTokenAmount(rawAmount: string, decimals: number): string {
  try {
    const amount = BigInt(rawAmount);
    return formatCompactValue(amount, decimals);
  } catch {
    return '0';
  }
}

/**
 * Small token logo with fallback
 */
function TokenLogo({ logoUrl, symbol }: { logoUrl?: string | null; symbol: string }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={symbol}
        className="w-4 h-4 rounded-full bg-slate-700"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          e.currentTarget.nextElementSibling?.classList.remove('hidden');
        }}
      />
    );
  }
  return (
    <div className="w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center">
      <Coins className="w-2.5 h-2.5 text-slate-400" />
    </div>
  );
}

export function AllocatedCapitalSection({
  allocatedBaseAmount,
  allocatedQuoteAmount,
  totalQuoteValue,
  baseToken,
  quoteToken,
  baseLogoUrl,
  quoteLogoUrl,
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

      {/* Token pair amounts on single line */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1">
          <TokenLogo logoUrl={baseLogoUrl} symbol={baseToken.symbol} />
          <span className="text-slate-400">{baseToken.symbol}</span>
          <span className="text-slate-500 mx-0.5">+</span>
          <TokenLogo logoUrl={quoteLogoUrl} symbol={quoteToken.symbol} />
          <span className="text-slate-400">{quoteToken.symbol}</span>
        </div>
        <span className="text-white font-medium">
          {baseFormatted} + {quoteFormatted}
        </span>
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
