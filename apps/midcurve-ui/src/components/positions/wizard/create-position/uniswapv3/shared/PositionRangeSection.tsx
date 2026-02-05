/**
 * PositionRangeSection - Displays the position's price range boundaries
 *
 * Shows the lower and upper price boundaries of a concentrated liquidity position.
 * Used in the summary panel across multiple wizard steps.
 */

import { formatCompactValue } from '@midcurve/shared';

export interface PositionRangeSectionProps {
  /**
   * Lower price boundary (in quote token units as bigint)
   */
  lowerPriceBigInt: bigint;

  /**
   * Upper price boundary (in quote token units as bigint)
   */
  upperPriceBigInt: bigint;

  /**
   * Quote token decimals for formatting
   */
  quoteTokenDecimals: number;
}

/**
 * Displays the position's price range with lower and upper boundaries
 */
export function PositionRangeSection({
  lowerPriceBigInt,
  upperPriceBigInt,
  quoteTokenDecimals,
}: PositionRangeSectionProps) {
  return (
    <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
      <p className="text-xs text-slate-400">Position Range</p>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-400">Lower</span>
          <span className="text-teal-400 font-medium">
            {formatCompactValue(lowerPriceBigInt, quoteTokenDecimals)}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-400">Upper</span>
          <span className="text-teal-400 font-medium">
            {formatCompactValue(upperPriceBigInt, quoteTokenDecimals)}
          </span>
        </div>
      </div>
    </div>
  );
}
