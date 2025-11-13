import type { AprPeriodData } from "@midcurve/api-shared";

/**
 * APR summary metrics calculated from periods array
 */
export interface AprSummary {
  /** Total fees collected from completed periods (in quote token units) */
  realizedFees: bigint;
  /** Time-weighted average cost basis across completed periods */
  realizedTWCostBasis: bigint;
  /** Total active days across completed periods */
  realizedActiveDays: number;
  /** Annualized APR from completed periods (%) */
  realizedApr: number;
  /** Current unclaimed fees (in quote token units) */
  unrealizedFees: bigint;
  /** Current position cost basis */
  unrealizedCostBasis: bigint;
  /** Days since last fee collection */
  unrealizedActiveDays: number;
  /** Estimated APR from current unclaimed fees (%) */
  unrealizedApr: number;
  /** Time-weighted total APR combining realized and unrealized (%) */
  totalApr: number;
  /** Total active days (realized + unrealized) */
  totalActiveDays: number;
}

/**
 * Calculate comprehensive APR summary from periods array
 *
 * Computes realized APR (from completed periods), unrealized APR (from current
 * unclaimed fees), and total time-weighted APR.
 *
 * **Realized APR:**
 * - Based on historical fee collection periods
 * - Uses time-weighted average cost basis for accuracy
 * - Formula: APR% = (fees / costBasis) * (365 / days) * 100
 *
 * **Unrealized APR:**
 * - Based on current unclaimed fees since last collection
 * - Uses current cost basis
 * - Same formula as realized
 *
 * **Total APR:**
 * - Time-weighted average of realized and unrealized APR
 * - Accounts for different durations of each component
 *
 * @param periods - Array of APR periods (sorted descending by startTimestamp)
 * @param currentCostBasis - Current position cost basis (for unrealized APR)
 * @param unclaimedFees - Current unclaimed fees (for unrealized APR)
 * @returns APR summary with realized, unrealized, and total metrics
 *
 * @example
 * ```typescript
 * const summary = calculateAprSummary(
 *   aprPeriods,
 *   BigInt(position.currentCostBasis),
 *   BigInt(position.unClaimedFees)
 * );
 * console.log(`Total APR: ${summary.totalApr.toFixed(2)}%`);
 * ```
 */
export function calculateAprSummary(
  periods: AprPeriodData[],
  currentCostBasis: bigint,
  unclaimedFees: bigint
): AprSummary {
  if (periods.length === 0) {
    return {
      realizedFees: 0n,
      realizedTWCostBasis: 0n,
      realizedActiveDays: 0,
      realizedApr: 0,
      unrealizedFees: unclaimedFees,
      unrealizedCostBasis: currentCostBasis,
      unrealizedActiveDays: 0,
      unrealizedApr: 0,
      totalApr: 0,
      totalActiveDays: 0,
    };
  }

  // Realized metrics (from completed periods)
  let realizedFees = 0n;
  let realizedWeightedCostBasisSum = 0n;
  let realizedTotalDays = 0;

  for (const period of periods) {
    const durationDays = period.durationSeconds / 86400;
    realizedFees += BigInt(period.collectedFeeValue);
    realizedWeightedCostBasisSum +=
      BigInt(period.costBasis) * BigInt(Math.floor(durationDays * 1000)); // Multiply by 1000 for precision
    realizedTotalDays += durationDays;
  }

  // Time-weighted cost basis = weighted sum / total days (with precision adjustment)
  const realizedTWCostBasis =
    realizedTotalDays > 0
      ? realizedWeightedCostBasisSum / BigInt(Math.floor(realizedTotalDays * 1000))
      : 0n;

  // Calculate realized APR
  // Formula: APR% = (fees / costBasis) * (365 / days) * 100
  // Rearranged: APR% = (fees * 365 * 100) / (costBasis * days)
  // Since fees and costBasis are both in same token units, they cancel out
  // We use floating point for the final calculation to avoid precision loss
  const realizedApr =
    realizedTWCostBasis > 0n && realizedTotalDays > 0
      ? (Number(realizedFees) / Number(realizedTWCostBasis)) * (365 / realizedTotalDays) * 100
      : 0;

  // Unrealized metrics (current open position)
  // Since we don't track "open periods" separately, we estimate:
  // - Unrealized cost basis = current cost basis
  // - Unrealized fees = unclaimed fees
  // - Days since last period end (or position start if no periods)
  const lastPeriodEnd = periods.length > 0 ? new Date(periods[0].endTimestamp) : null;
  const unrealizedActiveDays = lastPeriodEnd
    ? Math.max(0, (Date.now() - lastPeriodEnd.getTime()) / (1000 * 86400))
    : 0;

  // Calculate unrealized APR
  // Formula: APR% = (fees / costBasis) * (365 / days) * 100
  // Rearranged: APR% = (fees * 365 * 100) / (costBasis * days)
  // Since fees and costBasis are both in same token units, they cancel out
  // We use floating point for the final calculation to avoid precision loss
  const unrealizedApr =
    currentCostBasis > 0n && unrealizedActiveDays > 0
      ? (Number(unclaimedFees) / Number(currentCostBasis)) * (365 / unrealizedActiveDays) * 100
      : 0;

  // Total APR (time-weighted average)
  const totalActiveDays = realizedTotalDays + unrealizedActiveDays;
  const totalApr =
    totalActiveDays > 0
      ? (realizedApr * realizedTotalDays + unrealizedApr * unrealizedActiveDays) /
        totalActiveDays
      : 0;

  return {
    realizedFees,
    realizedTWCostBasis,
    realizedActiveDays: Math.floor(realizedTotalDays * 10) / 10, // Round to 1 decimal
    realizedApr,
    unrealizedFees: unclaimedFees,
    unrealizedCostBasis: currentCostBasis,
    unrealizedActiveDays: Math.floor(unrealizedActiveDays * 10) / 10, // Round to 1 decimal
    unrealizedApr,
    totalApr,
    totalActiveDays: Math.floor(totalActiveDays * 10) / 10, // Round to 1 decimal
  };
}
