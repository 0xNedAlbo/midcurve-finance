import { ArrowLeftRight, Coins } from 'lucide-react';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';

interface QuoteTokenSectionProps {
  quoteToken: PoolSearchTokenInfo | null;
  baseToken: PoolSearchTokenInfo | null;
  onSwap: () => void;
  quoteLogoUrl?: string | null;
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
        className="w-5 h-5 rounded-full bg-slate-700"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          e.currentTarget.nextElementSibling?.classList.remove('hidden');
        }}
      />
    );
  }
  return (
    <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center">
      <Coins className="w-3 h-3 text-slate-400" />
    </div>
  );
}

export function QuoteTokenSection({ quoteToken, baseToken, onSwap, quoteLogoUrl }: QuoteTokenSectionProps) {
  if (!quoteToken) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-1">Quote Token</p>
        <p className="text-slate-500 text-sm">Select a pool first</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-700/30 rounded-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400 mb-1">Quote Token</p>
          <div className="flex items-center gap-2">
            <TokenLogo logoUrl={quoteLogoUrl} symbol={quoteToken.symbol} />
            <span className="text-white font-medium">{quoteToken.symbol}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Value measured in {quoteToken.symbol}
          </p>
        </div>
        <button
          onClick={onSwap}
          disabled={!baseToken}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-600/50 rounded text-xs text-slate-300 hover:bg-slate-600 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Swap: use ${baseToken?.symbol || 'base'} as quote token`}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          Swap
        </button>
      </div>
    </div>
  );
}
