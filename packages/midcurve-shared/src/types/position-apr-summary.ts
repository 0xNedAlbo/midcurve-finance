/**
 * APR Summary Type Definitions
 *
 * Defines the structure for APR calculation results that combine
 * realized (historical) and unrealized (current) performance metrics.
 *
 * All monetary values are in quote token units (smallest denomination).
 */

/**
 * APR summary metrics combining realized and unrealized performance
 *
 * This interface represents the complete APR calculation for a position,
 * including both historical (realized) periods and current (unrealized) state.
 *
 * All fee and cost basis values are in quote token units (smallest denomination).
 * APR percentages are annualized and time-weighted.
 *
 * @example
 * ```typescript
 * const summary: AprSummary = {
 *   realizedFees: 50_000000n,        // 50 USDC collected
 *   realizedTWCostBasis: 10000_000000n, // Time-weighted avg 10k USDC
 *   realizedActiveDays: 30,
 *   realizedApr: 60.83,              // 60.83% APR from completed periods
 *
 *   unrealizedFees: 5_000000n,       // 5 USDC unclaimed
 *   unrealizedCostBasis: 10500_000000n, // Current 10.5k USDC
 *   unrealizedActiveDays: 5,
 *   unrealizedApr: 34.76,            // 34.76% projected APR
 *
 *   totalApr: 56.66,                 // Time-weighted total: 56.66% APR
 *   totalActiveDays: 35,
 *   belowThreshold: false
 * };
 * ```
 */
export interface AprSummary {
  // ============================================================================
  // REALIZED METRICS (from completed APR periods)
  // ============================================================================

  /**
   * Total fees collected in completed periods
   * In quote token units (smallest denomination)
   *
   * Sum of all collectedFeeValue from all APR periods.
   */
  realizedFees: bigint;

  /**
   * Time-weighted average cost basis across completed periods
   * In quote token units (smallest denomination)
   *
   * Calculated by weighting each period's cost basis by its duration,
   * ensuring that longer periods have more influence on the average.
   *
   * Formula: Σ(period.costBasis × period.durationSeconds) / Σ(period.durationSeconds)
   */
  realizedTWCostBasis: bigint;

  /**
   * Total active days across all completed periods
   *
   * Sum of duration (in days) for all periods with collected fees.
   */
  realizedActiveDays: number;

  /**
   * Annualized APR from completed periods
   * As a percentage (e.g., 26.09 represents 26.09% APR)
   *
   * Formula: (realizedFees / realizedTWCostBasis) × (365 / realizedActiveDays) × 100
   */
  realizedApr: number;

  // ============================================================================
  // UNREALIZED METRICS (from current unclaimed fees)
  // ============================================================================

  /**
   * Current unclaimed fees
   * In quote token units (smallest denomination)
   *
   * Fees that have accrued since the last COLLECT event but have not
   * been claimed yet.
   */
  unrealizedFees: bigint;

  /**
   * Current position cost basis
   * In quote token units (smallest denomination)
   *
   * The current capital invested in the position, used as the denominator
   * for unrealized APR calculation.
   */
  unrealizedCostBasis: bigint;

  /**
   * Days since last fee collection
   *
   * Time elapsed from the end of the last completed period (or position
   * opening if no collections) to now.
   */
  unrealizedActiveDays: number;

  /**
   * Projected annualized APR based on current unclaimed fees
   * As a percentage (e.g., 18.25 represents 18.25% APR)
   *
   * Formula: (unrealizedFees / unrealizedCostBasis) × (365 / unrealizedActiveDays) × 100
   *
   * Note: This is a projection based on recent performance and may not
   * reflect future APR if market conditions change.
   */
  unrealizedApr: number;

  // ============================================================================
  // TOTAL METRICS (time-weighted combination)
  // ============================================================================

  /**
   * Time-weighted total APR combining realized and unrealized periods
   * As a percentage (e.g., 25.03 represents 25.03% APR)
   *
   * Weights realized and unrealized APR by their respective durations
   * to provide a single, comprehensive APR metric.
   *
   * Formula: (realizedApr × realizedActiveDays + unrealizedApr × unrealizedActiveDays) / totalActiveDays
   *
   * This is the primary APR metric displayed in the UI.
   */
  totalApr: number;

  /**
   * Total active days (realized + unrealized)
   *
   * Combined duration of all completed periods plus time since last collection.
   */
  totalActiveDays: number;

  /**
   * Whether position history is below minimum threshold
   *
   * True if totalActiveDays < minimum threshold (typically 5 minutes = 0.00347 days).
   * When true, APR calculations are unreliable and should not be displayed.
   *
   * UI should show "-" or "N/A" instead of APR percentage when this is true.
   */
  belowThreshold: boolean;
}
