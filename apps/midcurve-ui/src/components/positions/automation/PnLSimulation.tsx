/**
 * PnL Simulation Component
 *
 * Reusable component that calculates and displays the expected PnL
 * for a position at a given trigger price.
 */

import { useMemo } from 'react';
import { calculatePositionValue, formatCompactValue } from '@midcurve/shared';

export interface PnLSimulationProps {
  /**
   * Position liquidity
   */
  liquidity: bigint;

  /**
   * Position lower tick
   */
  tickLower: number;

  /**
   * Position upper tick
   */
  tickUpper: number;

  /**
   * Current cost basis (in quote token units, as string)
   */
  currentCostBasis: string;

  /**
   * Current unclaimed fees (in quote token units, as string)
   */
  unclaimedFees: string;

  /**
   * Trigger price in sqrtPriceX96 format
   */
  triggerSqrtPriceX96: string;

  /**
   * Current pool price in sqrtPriceX96 format
   */
  currentSqrtPriceX96: string;

  /**
   * Whether token0 is the quote token (affects price direction)
   */
  isToken0Quote: boolean;

  /**
   * Quote token info for formatting
   */
  quoteToken: {
    decimals: number;
    symbol: string;
  };

  /**
   * Optional trigger mode for immediate execution detection
   * - 'LOWER': Stop-loss (triggers when price falls below)
   * - 'UPPER': Take-profit (triggers when price rises above)
   */
  triggerMode?: 'LOWER' | 'UPPER';

  /**
   * Optional custom label (defaults to "Expected PnL at trigger:")
   */
  label?: string;
}

export type PnLSimulationResult = {
  isValid: false;
} | {
  isValid: true;
  value: bigint;
  isProfit: boolean;
  displayValue: string;
  feesDisplay: string;
}

/**
 * Hook to calculate PnL simulation
 * Exported for use in components that need the raw data without UI
 */
export function usePnLSimulation({
  liquidity,
  tickLower,
  tickUpper,
  currentCostBasis,
  unclaimedFees,
  triggerSqrtPriceX96,
  currentSqrtPriceX96,
  isToken0Quote,
  quoteToken,
  triggerMode,
}: PnLSimulationProps): PnLSimulationResult {
  return useMemo(() => {
    // Validation: return invalid if no trigger price or zero liquidity
    if (!triggerSqrtPriceX96 || triggerSqrtPriceX96 === '0' || liquidity === 0n) {
      return { isValid: false as const };
    }

    try {
      const triggerPrice = BigInt(triggerSqrtPriceX96);
      const currentPrice = BigInt(currentSqrtPriceX96);

      // Handle immediate execution case
      // For SL: should trigger when price falls BELOW trigger
      // For TP: should trigger when price rises ABOVE trigger
      let effectivePrice = triggerPrice;

      if (triggerMode === 'LOWER') {
        // Stop-loss triggers when price falls below trigger
        // If trigger >= current (would execute immediately), use current price
        // Note: isToken0Quote inverts the relationship
        const wouldExecuteImmediately = isToken0Quote
          ? triggerPrice <= currentPrice // inverted: lower sqrt = higher user price
          : triggerPrice >= currentPrice;
        if (wouldExecuteImmediately) {
          effectivePrice = currentPrice;
        }
      } else if (triggerMode === 'UPPER') {
        // Take-profit triggers when price rises above trigger
        // If trigger <= current (would execute immediately), use current price
        const wouldExecuteImmediately = isToken0Quote
          ? triggerPrice >= currentPrice // inverted: higher sqrt = lower user price
          : triggerPrice <= currentPrice;
        if (wouldExecuteImmediately) {
          effectivePrice = currentPrice;
        }
      }

      // Calculate position value at effective price
      const baseIsToken0 = !isToken0Quote;
      const valueAtTrigger = calculatePositionValue(
        liquidity,
        effectivePrice,
        tickLower,
        tickUpper,
        baseIsToken0
      );

      // Calculate simulated PnL including fees
      const costBasis = BigInt(currentCostBasis || '0');
      const fees = BigInt(unclaimedFees || '0');
      const pnl = valueAtTrigger - costBasis + fees;

      // Format the display value
      const displayValue = formatCompactValue(pnl < 0n ? -pnl : pnl, quoteToken.decimals);

      return {
        isValid: true as const,
        value: pnl,
        isProfit: pnl >= 0n,
        displayValue,
        feesDisplay: formatCompactValue(fees, quoteToken.decimals),
      };
    } catch {
      return { isValid: false as const };
    }
  }, [
    triggerSqrtPriceX96,
    currentSqrtPriceX96,
    isToken0Quote,
    triggerMode,
    liquidity,
    tickLower,
    tickUpper,
    currentCostBasis,
    unclaimedFees,
    quoteToken.decimals,
  ]);
}

/**
 * PnL Simulation display component
 */
export function PnLSimulation(props: PnLSimulationProps) {
  const { quoteToken, label = 'Expected PnL at trigger:' } = props;
  const simulatedPnL = usePnLSimulation(props);

  return (
    <div className="p-3 bg-slate-700/30 rounded-lg">
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-400">{label}</span>
        {simulatedPnL.isValid ? (
          <span
            className={`text-sm font-medium ${
              simulatedPnL.isProfit ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {simulatedPnL.isProfit ? '+' : '-'}
            {simulatedPnL.displayValue} {quoteToken.symbol}
          </span>
        ) : (
          <span className="text-sm text-slate-500">n/a</span>
        )}
      </div>
      {simulatedPnL.isValid && (
        <p className="text-xs text-slate-500 mt-1">
          Includes {simulatedPnL.feesDisplay} {quoteToken.symbol} unclaimed fees
        </p>
      )}
    </div>
  );
}
