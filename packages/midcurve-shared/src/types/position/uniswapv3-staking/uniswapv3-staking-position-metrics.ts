/**
 * UniswapV3 Staking Position Metrics
 *
 * Calculated metrics for a UniswapV3StakingVault position without database
 * persistence. Returned by `fetchMetrics()` for read-only inspection
 * (used by GET endpoint serializers in PR4b).
 *
 * Mirrors `UniswapV3VaultPositionMetrics` but with staking-specific fields
 * (`vaultState`, `yieldTarget`, `pendingBps`).
 */

/**
 * UniswapV3StakingPositionMetrics
 *
 * Contains calculated position metrics in quote-token terms. All monetary
 * values are in quote-token units (bigint for precision).
 *
 * @example
 * ```typescript
 * const metrics = await positionService.fetchMetrics(positionId);
 * console.log(`Position value: ${metrics.currentValue}`);
 * console.log(`Vault state: ${metrics.vaultState}`);
 * console.log(`Yield target: ${metrics.yieldTarget}`);
 * ```
 */
export interface UniswapV3StakingPositionMetrics {
  // ============================================================================
  // Value & PnL
  // ============================================================================

  /**
   * Current position value in quote-token units.
   * Calculated from liquidity and current pool price.
   */
  currentValue: bigint;

  /**
   * Cost basis in quote-token units.
   * Accumulated from STAKING_DEPOSIT ledger events (PR1).
   */
  costBasis: bigint;

  /**
   * Realized PnL in quote-token units.
   * Model A: principal-vs-cost-basis only. Yield is excluded — see `collectedYield`.
   */
  realizedPnl: bigint;

  /**
   * Unrealized PnL in quote-token units.
   * Calculated as `currentValue − costBasis`.
   */
  unrealizedPnl: bigint;

  // ============================================================================
  // Yield Metrics (Model A: yield is fee income, not PnL)
  // ============================================================================

  /**
   * Total collected yield in quote-token units.
   * Accumulated from STAKING_DISPOSE ledger events' `yieldQuoteValue` (PR1).
   */
  collectedYield: bigint;

  /**
   * Unclaimed yield in quote-token units.
   * Computed from `unclaimedYieldBase × P + unclaimedYieldQuote` at the
   * current pool price.
   */
  unclaimedYield: bigint;

  /**
   * Timestamp of the last STAKING_DISPOSE event.
   * Falls back to `positionOpenedAt` if no disposals yet.
   */
  lastYieldClaimedAt: Date;

  // ============================================================================
  // Stake Terms
  // ============================================================================

  /**
   * Quote-side reward floor specified at stake time (immutable until top-up).
   * The vault settles only when accumulated yield meets or exceeds this target.
   */
  yieldTarget: bigint;

  /**
   * Pending partial-unstake bps (0..10000).
   * The bps fraction of the position that will unstake on the next executor swap.
   */
  pendingBps: number;

  /**
   * On-chain vault state.
   * - `Empty`: pre-stake / post-settlement
   * - `Staked`: actively staked, accumulating yield
   * - `FlashCloseInProgress`: mid-flashClose flight (transient, only visible mid-tx)
   * - `Settled`: fully closed
   */
  vaultState: 'Empty' | 'Staked' | 'FlashCloseInProgress' | 'Settled';

  // ============================================================================
  // Price Range
  // ============================================================================

  /** Lower bound of the position range in quote-token price. */
  priceRangeLower: bigint;

  /** Upper bound of the position range in quote-token price. */
  priceRangeUpper: bigint;

  // ============================================================================
  // Ownership
  // ============================================================================

  /**
   * Whether the underlying vault clone is currently owned by the user.
   * Determined by checking `vault.owner()` against the user's registered wallets.
   */
  isOwnedByUser: boolean;
}
