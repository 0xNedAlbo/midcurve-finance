/**
 * PostCloseSwapSection - Displays post-close swap configuration for SL/TP triggers
 *
 * Shows swap direction and slippage for each trigger (e.g. "WETH → USDC (1.0%)").
 * Used in summary panels across multiple wizard steps.
 */

export interface SwapConfigDisplay {
  enabled: boolean;
  swapToQuote: boolean;
  slippageBps: number;
}

export interface PostCloseSwapSectionProps {
  slSwapConfig?: SwapConfigDisplay | null;
  tpSwapConfig?: SwapConfigDisplay | null;
  baseSymbol: string;
  quoteSymbol: string;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
}

function formatSwapConfig(
  config: SwapConfigDisplay,
  baseSymbol: string,
  quoteSymbol: string,
): string {
  const from = config.swapToQuote ? baseSymbol : quoteSymbol;
  const to = config.swapToQuote ? quoteSymbol : baseSymbol;
  return `${from} \u2192 ${to} (${(config.slippageBps / 100).toFixed(1)}%)`;
}

export function PostCloseSwapSection({
  slSwapConfig,
  tpSwapConfig,
  baseSymbol,
  quoteSymbol,
  hasStopLoss,
  hasTakeProfit,
}: PostCloseSwapSectionProps) {
  if (!hasStopLoss && !hasTakeProfit) return null;

  return (
    <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
      <p className="text-xs text-slate-400">Post-Close Swap</p>
      <div className="space-y-1.5">
        {hasStopLoss && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">SL</span>
            <span
              className={
                slSwapConfig?.enabled
                  ? 'text-blue-400 font-medium'
                  : 'text-slate-500'
              }
            >
              {slSwapConfig?.enabled
                ? formatSwapConfig(slSwapConfig, baseSymbol, quoteSymbol)
                : 'Disabled'}
            </span>
          </div>
        )}
        {hasTakeProfit && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">TP</span>
            <span
              className={
                tpSwapConfig?.enabled
                  ? 'text-blue-400 font-medium'
                  : 'text-slate-500'
              }
            >
              {tpSwapConfig?.enabled
                ? formatSwapConfig(tpSwapConfig, baseSymbol, quoteSymbol)
                : 'Disabled'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
