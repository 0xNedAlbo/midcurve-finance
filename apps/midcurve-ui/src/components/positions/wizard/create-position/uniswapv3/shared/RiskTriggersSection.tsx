/**
 * RiskTriggersSection - Displays Stop Loss and Take Profit trigger prices
 *
 * Shows the configured SL/TP trigger prices with optional PnL values.
 * Used in the summary panel across multiple wizard steps.
 */

import { formatCompactValue } from '@midcurve/shared';

export interface RiskTriggersSectionProps {
  /**
   * Stop Loss trigger price (in quote token units as bigint), or null if not set
   */
  stopLossPrice: bigint | null;

  /**
   * Take Profit trigger price (in quote token units as bigint), or null if not set
   */
  takeProfitPrice: bigint | null;

  /**
   * Stop Loss drawdown info (PnL value at SL trigger)
   */
  slDrawdown?: { pnlValue: bigint } | null;

  /**
   * Take Profit runup info (PnL value at TP trigger)
   */
  tpRunup?: { pnlValue: bigint } | null;

  /**
   * Quote token decimals for formatting
   */
  quoteTokenDecimals: number;
}

/**
 * Displays the position's risk triggers (Stop Loss and Take Profit)
 */
export function RiskTriggersSection({
  stopLossPrice,
  takeProfitPrice,
  slDrawdown,
  tpRunup,
  quoteTokenDecimals,
}: RiskTriggersSectionProps) {
  // Don't render if neither SL nor TP is set
  if (stopLossPrice === null && takeProfitPrice === null) {
    return null;
  }

  return (
    <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
      <p className="text-xs text-slate-400">Risk Triggers</p>
      <div className="space-y-1.5">
        {stopLossPrice !== null && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">Stop Loss</span>
            <span className="text-red-400 font-medium">
              {formatCompactValue(stopLossPrice, quoteTokenDecimals)}
              {slDrawdown && (
                <span className="text-slate-500 font-normal ml-1">
                  ({formatCompactValue(slDrawdown.pnlValue, quoteTokenDecimals)})
                </span>
              )}
            </span>
          </div>
        )}
        {takeProfitPrice !== null && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">Take Profit</span>
            <span className="text-green-400 font-medium">
              {formatCompactValue(takeProfitPrice, quoteTokenDecimals)}
              {tpRunup && (
                <span className="text-slate-500 font-normal ml-1">
                  (+{formatCompactValue(tpRunup.pnlValue, quoteTokenDecimals)})
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
