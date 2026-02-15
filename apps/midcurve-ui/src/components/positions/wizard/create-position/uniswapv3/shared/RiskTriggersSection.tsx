/**
 * RiskTriggersSection - Displays Stop Loss and Take Profit trigger prices
 *
 * Shows the configured SL/TP trigger prices with optional PnL values.
 * Used in the summary panel across multiple wizard steps.
 */

import { formatCompactValue, INFINITE_RUNUP } from '@midcurve/shared';

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
   * Stop Loss drawdown info (PnL value and optional percent at SL trigger)
   */
  slDrawdown?: { pnlValue: bigint; pnlPercent?: number } | null;

  /**
   * Take Profit runup info (PnL value and optional percent at TP trigger)
   */
  tpRunup?: { pnlValue: bigint; pnlPercent?: number } | null;

  /**
   * Quote token decimals for formatting
   */
  quoteTokenDecimals: number;

  /**
   * Quote token symbol for display (optional — when provided, shown on sub-line)
   */
  quoteSymbol?: string;
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
  return (
    <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
      <p className="text-xs text-slate-400">Risk Profile</p>
      <div className="space-y-1.5">
        <div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">Stop Loss</span>
            {stopLossPrice !== null ? (
              <span className="text-red-400 font-medium">
                {formatCompactValue(stopLossPrice, quoteTokenDecimals)}
              </span>
            ) : (
              <span className="text-slate-500">None</span>
            )}
          </div>
          {slDrawdown && (
            <div className="flex justify-between items-center text-sm pl-3 mt-0.5">
              <span className="text-slate-400">Max Drawdown</span>
              <span className="text-red-400 font-medium">
                {slDrawdown.pnlPercent != null && slDrawdown.pnlPercent <= -100
                  ? 'Total Loss'
                  : formatCompactValue(slDrawdown.pnlValue, quoteTokenDecimals)}
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">Take Profit</span>
            {takeProfitPrice !== null ? (
              <span className="text-green-400 font-medium">
                {formatCompactValue(takeProfitPrice, quoteTokenDecimals)}
              </span>
            ) : (
              <span className="text-slate-500">None</span>
            )}
          </div>
          {tpRunup && (
            <div className="flex justify-between items-center text-sm pl-3 mt-0.5">
              <span className="text-slate-400">Max Runup</span>
              <span className="text-green-400 font-medium">
                {tpRunup.pnlValue === INFINITE_RUNUP
                  ? '\u221E'
                  : `+${formatCompactValue(tpRunup.pnlValue, quoteTokenDecimals)}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
