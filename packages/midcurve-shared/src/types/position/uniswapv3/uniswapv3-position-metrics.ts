/**
 * Uniswap V3 Position Metrics
 *
 * Type representing calculated position metrics without database persistence.
 * Used by fetchMetrics() to return metrics for read-only operations.
 */

/**
 * UniswapV3PositionMetrics
 *
 * Contains calculated position metrics in quote token terms.
 * All monetary values are in quote token units (bigint for precision).
 *
 * @example
 * ```typescript
 * const metrics = await positionService.fetchMetrics(positionId);
 * console.log(`Position value: ${metrics.currentValue}`);
 * console.log(`Unrealized PnL: ${metrics.unrealizedPnl}`);
 * ```
 */
export interface UniswapV3PositionMetrics {
  // ============================================================================
  // Value & PnL
  // ============================================================================

  /**
   * Current position value in quote token units.
   * Calculated from liquidity and current pool price.
   */
  currentValue: bigint;

  /**
   * Cost basis in quote token units.
   * Accumulated from ledger events (INCREASE_LIQUIDITY adds, DECREASE_LIQUIDITY subtracts).
   */
  costBasis: bigint;

  /**
   * Realized PnL in quote token units.
   * Accumulated from ledger events when liquidity is decreased.
   */
  realizedPnl: bigint;

  /**
   * Unrealized PnL in quote token units.
   * Calculated as: currentValue - costBasis
   */
  unrealizedPnl: bigint;

  // ============================================================================
  // Fee Metrics
  // ============================================================================

  /**
   * Total collected yield in quote token units.
   * Accumulated from COLLECT ledger events.
   */
  collectedYield: bigint;

  /**
   * Unclaimed yield in quote token units.
   * Calculated from on-chain fee state converted to quote token value.
   */
  unclaimedYield: bigint;

  /**
   * Timestamp of last yield claim.
   * Falls back to position opened date if no collections yet.
   */
  lastYieldClaimedAt: Date;

  // ============================================================================
  // Price Range
  // ============================================================================

  /**
   * Lower bound of position range in quote token price.
   * Converted from tickLower using pool token decimals.
   */
  priceRangeLower: bigint;

  /**
   * Upper bound of position range in quote token price.
   * Converted from tickUpper using pool token decimals.
   */
  priceRangeUpper: bigint;

  // ============================================================================
  // Ownership
  // ============================================================================

  /**
   * Whether the position is currently owned by the user.
   * Determined by checking the on-chain owner address against the user's registered wallets.
   */
  isOwnedByUser: boolean;
}
