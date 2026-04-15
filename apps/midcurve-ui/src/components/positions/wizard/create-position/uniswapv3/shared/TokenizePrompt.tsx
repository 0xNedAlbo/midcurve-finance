import { useState } from 'react';
import { Circle, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface TokenizePromptProps {
  enabled: boolean;
  showActionButton: boolean;
  nftId: string;
  chainId: number;
  liquidity: string;
  onTokenize: (params: { tokenName: string; tokenSymbol: string; decimals: number }) => void;
  onSkip: () => void;
}

/**
 * Compute default vault token decimals from position liquidity.
 * Formula: max(0, floor(log10(L)) - 4)
 */
function computeDefaultDecimals(liquidity: string): number {
  if (!liquidity || liquidity === '0') return 0;
  const digits = liquidity.length;
  return Math.max(0, digits - 1 - 4);
}

export function TokenizePrompt({
  enabled,
  showActionButton,
  nftId,
  chainId,
  liquidity,
  onTokenize,
  onSkip,
}: TokenizePromptProps) {
  const defaultDecimals = computeDefaultDecimals(liquidity);
  const [status, setStatus] = useState<'idle' | 'skipped'>('idle');
  const [isExpanded, setIsExpanded] = useState(false);
  const [tokenName, setTokenName] = useState(`UniswapV3 Tokenized Position #${nftId}`);
  const [tokenSymbol, setTokenSymbol] = useState(`uv3-${chainId}-${nftId}`);
  const [decimals, setDecimals] = useState(defaultDecimals);

  const isSkipped = status === 'skipped';

  const handleTokenize = () => {
    onTokenize({ tokenName, tokenSymbol, decimals });
  };

  const handleSkip = () => {
    setStatus('skipped');
    onSkip();
  };

  return (
    <div
      className={`py-3 px-4 rounded-lg transition-colors ${
        isSkipped
          ? 'bg-green-500/10 border border-green-500/20'
          : 'bg-slate-700/30 border border-slate-600/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSkipped ? (
            <Check className="w-5 h-5 text-green-400" />
          ) : (
            <Circle className="w-5 h-5 text-slate-500" />
          )}
          <span className={isSkipped ? 'text-slate-400' : 'text-white'}>
            Tokenize your Position
            {isSkipped && <span className="text-slate-500 ml-1">— Skipped</span>}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {enabled && showActionButton && !isSkipped && (
            <>
              <button
                onClick={handleSkip}
                className="px-3 py-1.5 text-slate-400 text-sm hover:text-white transition-colors cursor-pointer"
              >
                Skip
              </button>
              <button
                onClick={handleTokenize}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Tokenize
              </button>
            </>
          )}
        </div>
      </div>

      {/* Advanced Settings Toggle */}
      {enabled && !isSkipped && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 mt-2 ml-8 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          Advanced Settings
        </button>
      )}

      {/* Advanced Settings Fields */}
      {enabled && !isSkipped && isExpanded && (
        <div className="mt-3 ml-8 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Token Name</label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800/50 border border-slate-600/30 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Token Symbol</label>
            <input
              type="text"
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800/50 border border-slate-600/30 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Decimals</label>
            <input
              type="number"
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
              min={0}
              max={18}
              className="w-full px-3 py-1.5 bg-slate-800/50 border border-slate-600/30 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
        </div>
      )}
    </div>
  );
}
