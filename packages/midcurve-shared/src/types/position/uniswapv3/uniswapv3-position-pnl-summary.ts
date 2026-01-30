/**
 * Uniswap V3 Position PnL Summary
 *
 * Type representing calculated PnL breakdown metrics without database persistence.
 * Used by fetchPnLSummary() to return PnL breakdown for display.
 *
 * All monetary values are in quote token units (smallest denomination).
 */

/**
 * UniswapV3PositionPnLSummary
 *
 * Contains PnL breakdown metrics split into realized and unrealized components.
 *
 * @example
 * ```typescript
 * const pnlSummary = await positionService.fetchPnLSummary(positionId);
 * console.log(`Total PnL: ${pnlSummary.totalPnl}`);
 * console.log(`Unrealized: ${pnlSummary.unrealizedSubtotal}`);
 * ```
 */
export interface UniswapV3PositionPnLSummary {
  // ============================================================================
  // Realized PnL (from completed events)
  // ============================================================================

  /**
   * Total fees collected in quote token units.
   * Sum of all COLLECT event fee values converted to quote token.
   */
  collectedFees: bigint;

  /**
   * Realized PnL from withdrawn assets in quote token units.
   * PnL realized when liquidity was decreased (withdrawn amount - proportional cost basis).
   */
  realizedPnl: bigint;

  /**
   * Subtotal of realized PnL = collectedFees + realizedPnl
   * This is the profit/loss that has been "locked in" through actual transactions.
   */
  realizedSubtotal: bigint;

  // ============================================================================
  // Unrealized PnL (current position state)
  // ============================================================================

  /**
   * Current unclaimed fees in quote token units.
   * Fees that have accrued but not yet collected.
   */
  unClaimedFees: bigint;

  /**
   * Current position value in quote token units.
   * Calculated from liquidity and current pool price.
   */
  currentValue: bigint;

  /**
   * Current cost basis in quote token units.
   * The capital invested in the current position.
   */
  currentCostBasis: bigint;

  /**
   * Subtotal of unrealized PnL = unClaimedFees + currentValue - currentCostBasis
   * This is the profit/loss that would be realized if position were closed now.
   */
  unrealizedSubtotal: bigint;

  // ============================================================================
  // Total PnL
  // ============================================================================

  /**
   * Total PnL = realizedSubtotal + unrealizedSubtotal
   * The complete profit/loss accounting for both realized and unrealized gains/losses.
   */
  totalPnl: bigint;
}
