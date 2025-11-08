/**
 * PnL Display Values Hook
 *
 * Hook for formatting PnL breakdown data for display in position detail views.
 * Calculates total PnL including fees, determines color classes, and provides boolean flags.
 */

import { useMemo } from "react";

interface PnlBreakdown {
  currentValue: string;
  currentCostBasis: string;
  realizedPnL: string;
  collectedFees: string;
  unclaimedFees: string;
}

interface PnLDisplayValues {
  currentValue: bigint | null;
  totalPnL: bigint | null;
  unclaimedFees: bigint | null;
  pnlColor: string;
  isPositive: boolean;
  isNegative: boolean;
}

/**
 * Hook to get formatted display values for PnL data
 *
 * @param pnlData - PnL breakdown data from API
 * @param _quoteTokenDecimals - Quote token decimals (unused but kept for compatibility)
 * @returns Object with calculated PnL values and display properties
 */
export function usePnLDisplayValues(
  pnlData: PnlBreakdown | undefined,
  _quoteTokenDecimals: number
): PnLDisplayValues {
  return useMemo(() => {
    if (!pnlData) {
      return {
        currentValue: null,
        totalPnL: null,
        unclaimedFees: null,
        pnlColor: "text-slate-400",
        isPositive: false,
        isNegative: false,
      };
    }

    // Calculate total PnL including fees
    // Total PnL = realizedPnL + unrealizedPnL + unclaimedFees + collectedFees
    // Where unrealizedPnL = currentValue - currentCostBasis
    const unrealizedPnL = BigInt(pnlData.currentValue) - BigInt(pnlData.currentCostBasis);
    const totalPnL =
      BigInt(pnlData.realizedPnL) +
      unrealizedPnL +
      BigInt(pnlData.unclaimedFees) +
      BigInt(pnlData.collectedFees);

    const isPositive = totalPnL > 0n;
    const isNegative = totalPnL < 0n;

    const pnlColor = isPositive
      ? "text-green-400"
      : isNegative
      ? "text-red-400"
      : "text-slate-400";

    return {
      currentValue: BigInt(pnlData.currentValue),
      totalPnL,
      unclaimedFees: BigInt(pnlData.unclaimedFees),
      pnlColor,
      isPositive,
      isNegative,
    };
  }, [pnlData]);
}
