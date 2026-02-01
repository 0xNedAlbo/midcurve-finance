/**
 * Close Order Simulation Overlay
 *
 * A decorator/wrapper class that wraps an underlying position and simulates
 * what happens when a take-profit (TP) or stop-loss (SL) trigger is hit.
 *
 * This is for UI simulation purposes only, not for real position tracking.
 * It allows the UI to visualize PnL curves with simulated trigger outcomes.
 */

import type { Erc20Token } from '../../token/index.js';
import type { UniswapV3Pool } from '../../pool/index.js';
import type { PositionInterface } from '../position.interface.js';
import type { PositionProtocol, PositionType, PositionJSON } from '../position.types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Trigger state for the simulation overlay.
 * - IN_POSITION: No trigger hit, delegates to underlying position
 * - TP_TRIGGERED: Take-profit triggered, returns simulated values at TP price
 * - SL_TRIGGERED: Stop-loss triggered, returns simulated values at SL price
 */
export type CloseOrderTriggerState = 'IN_POSITION' | 'TP_TRIGGERED' | 'SL_TRIGGERED';

/**
 * Constructor parameters for CloseOrderSimulationOverlay.
 */
export interface CloseOrderSimulationOverlayParams {
  /** The underlying position to wrap */
  underlyingPosition: PositionInterface;
  /** Take-profit trigger price in quote token units (null = no TP) */
  takeProfitPrice: bigint | null;
  /** Stop-loss trigger price in quote token units (null = no SL) */
  stopLossPrice: bigint | null;
}

// ============================================================================
// CLASS
// ============================================================================

/**
 * CloseOrderSimulationOverlay
 *
 * Wraps an underlying position and simulates TP/SL trigger behavior.
 *
 * When plotting PnL curves:
 * - IN_POSITION: Returns normal curved PnL graph from underlying
 * - TP_TRIGGERED: Returns flat horizontal line at TP PnL (if TP defined)
 * - SL_TRIGGERED: Returns flat horizontal line at SL PnL (if SL defined)
 *
 * If a trigger price is null, that trigger is ignored and the overlay
 * behaves as IN_POSITION for that trigger state.
 *
 * @example
 * ```typescript
 * // With both TP and SL
 * const overlay = new CloseOrderSimulationOverlay({
 *   underlyingPosition: position,
 *   takeProfitPrice: 2500n * 10n ** 6n, // $2500 in USDC (6 decimals)
 *   stopLossPrice: 1800n * 10n ** 6n,   // $1800 in USDC
 * });
 *
 * // With only SL (no TP)
 * const slOnlyOverlay = new CloseOrderSimulationOverlay({
 *   underlyingPosition: position,
 *   takeProfitPrice: null,              // No take-profit
 *   stopLossPrice: 1800n * 10n ** 6n,
 * });
 *
 * // Normal PnL curve
 * overlay.simulatePnLAtPrice(2000n * 10n ** 6n); // Returns curved value
 *
 * // Simulate TP trigger
 * overlay.setTriggerState('TP_TRIGGERED');
 * overlay.simulatePnLAtPrice(2000n * 10n ** 6n); // Returns fixed TP PnL
 * overlay.simulatePnLAtPrice(3000n * 10n ** 6n); // Returns same fixed TP PnL
 *
 * // If TP is null, TP_TRIGGERED behaves like IN_POSITION
 * slOnlyOverlay.setTriggerState('TP_TRIGGERED');
 * slOnlyOverlay.simulatePnLAtPrice(2000n * 10n ** 6n); // Returns curved value (no TP defined)
 * ```
 */
export class CloseOrderSimulationOverlay implements PositionInterface {
  private readonly _underlying: PositionInterface;
  private readonly _takeProfitPrice: bigint | null;
  private readonly _stopLossPrice: bigint | null;
  private _triggerState: CloseOrderTriggerState = 'IN_POSITION';

  // Cached simulated values (calculated lazily)
  // undefined = not calculated yet, bigint = calculated value
  private _cachedPnLAtTP: bigint | undefined = undefined;
  private _cachedPnLAtSL: bigint | undefined = undefined;
  private _cachedValueAtTP: bigint | undefined = undefined;
  private _cachedValueAtSL: bigint | undefined = undefined;

  constructor(params: CloseOrderSimulationOverlayParams) {
    this._underlying = params.underlyingPosition;
    this._takeProfitPrice = params.takeProfitPrice;
    this._stopLossPrice = params.stopLossPrice;
  }

  // ============================================================================
  // Trigger State Management
  // ============================================================================

  /**
   * Get current trigger state.
   */
  get triggerState(): CloseOrderTriggerState {
    return this._triggerState;
  }

  /**
   * Set trigger state.
   * This determines whether the overlay returns underlying values or simulated values.
   */
  setTriggerState(state: CloseOrderTriggerState): void {
    this._triggerState = state;
  }

  /**
   * Get the take-profit trigger price (null if not set).
   */
  get takeProfitPrice(): bigint | null {
    return this._takeProfitPrice;
  }

  /**
   * Get the stop-loss trigger price (null if not set).
   */
  get stopLossPrice(): bigint | null {
    return this._stopLossPrice;
  }

  /**
   * Check if take-profit is configured.
   */
  get hasTakeProfit(): boolean {
    return this._takeProfitPrice !== null;
  }

  /**
   * Check if stop-loss is configured.
   */
  get hasStopLoss(): boolean {
    return this._stopLossPrice !== null;
  }

  /**
   * Get the underlying position.
   */
  get underlyingPosition(): PositionInterface {
    return this._underlying;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get the cached PnL at take-profit price (lazy calculation).
   * Returns null if TP is not configured.
   */
  private get pnlAtTP(): bigint | null {
    if (this._takeProfitPrice === null) {
      return null;
    }
    if (this._cachedPnLAtTP === undefined) {
      this._cachedPnLAtTP = this._underlying.simulatePnLAtPrice(this._takeProfitPrice);
    }
    return this._cachedPnLAtTP;
  }

  /**
   * Get the cached PnL at stop-loss price (lazy calculation).
   * Returns null if SL is not configured.
   */
  private get pnlAtSL(): bigint | null {
    if (this._stopLossPrice === null) {
      return null;
    }
    if (this._cachedPnLAtSL === undefined) {
      this._cachedPnLAtSL = this._underlying.simulatePnLAtPrice(this._stopLossPrice);
    }
    return this._cachedPnLAtSL;
  }

  /**
   * Get the cached position value at take-profit price (lazy calculation).
   * Returns null if TP is not configured.
   */
  private get valueAtTP(): bigint | null {
    if (this._takeProfitPrice === null) {
      return null;
    }
    if (this._cachedValueAtTP === undefined) {
      // Value = PnL + CostBasis
      const pnl = this.pnlAtTP;
      if (pnl === null) return null;
      this._cachedValueAtTP = pnl + this._underlying.currentCostBasis;
    }
    return this._cachedValueAtTP;
  }

  /**
   * Get the cached position value at stop-loss price (lazy calculation).
   * Returns null if SL is not configured.
   */
  private get valueAtSL(): bigint | null {
    if (this._stopLossPrice === null) {
      return null;
    }
    if (this._cachedValueAtSL === undefined) {
      // Value = PnL + CostBasis
      const pnl = this.pnlAtSL;
      if (pnl === null) return null;
      this._cachedValueAtSL = pnl + this._underlying.currentCostBasis;
    }
    return this._cachedValueAtSL;
  }

  /**
   * Check if a trigger is effectively active.
   * A trigger is only active if the state is set AND the trigger price is defined.
   */
  private get isEffectivelyTriggered(): boolean {
    if (this._triggerState === 'IN_POSITION') {
      return false;
    }
    if (this._triggerState === 'TP_TRIGGERED') {
      return this._takeProfitPrice !== null;
    }
    if (this._triggerState === 'SL_TRIGGERED') {
      return this._stopLossPrice !== null;
    }
    return false;
  }

  /**
   * Get the simulated PnL at the active trigger price.
   * Returns underlying's current unrealizedPnl if trigger price is not defined.
   */
  private get simulatedPnL(): bigint {
    if (this._triggerState === 'TP_TRIGGERED') {
      const pnl = this.pnlAtTP;
      return pnl !== null ? pnl : this._underlying.unrealizedPnl;
    }
    if (this._triggerState === 'SL_TRIGGERED') {
      const pnl = this.pnlAtSL;
      return pnl !== null ? pnl : this._underlying.unrealizedPnl;
    }
    return this._underlying.unrealizedPnl;
  }

  /**
   * Get the simulated value at the active trigger price.
   * Returns underlying's current value if trigger price is not defined.
   */
  private get simulatedValue(): bigint {
    if (this._triggerState === 'TP_TRIGGERED') {
      const value = this.valueAtTP;
      return value !== null ? value : this._underlying.currentValue;
    }
    if (this._triggerState === 'SL_TRIGGERED') {
      const value = this.valueAtSL;
      return value !== null ? value : this._underlying.currentValue;
    }
    return this._underlying.currentValue;
  }

  // ============================================================================
  // PositionInterface - Identity (always delegate)
  // ============================================================================

  get id(): string {
    return this._underlying.id;
  }

  get positionHash(): string {
    return this._underlying.positionHash;
  }

  get userId(): string {
    return this._underlying.userId;
  }

  get protocol(): PositionProtocol {
    return this._underlying.protocol;
  }

  get positionType(): PositionType {
    return this._underlying.positionType;
  }

  // ============================================================================
  // PositionInterface - Pool Reference (always delegate)
  // ============================================================================

  get pool(): UniswapV3Pool {
    return this._underlying.pool;
  }

  get isToken0Quote(): boolean {
    return this._underlying.isToken0Quote;
  }

  // ============================================================================
  // PositionInterface - PnL Fields (simulated when triggered)
  // ============================================================================

  /**
   * Current value - returns simulated value at trigger price when triggered.
   */
  get currentValue(): bigint {
    return this.isEffectivelyTriggered ? this.simulatedValue : this._underlying.currentValue;
  }

  /**
   * Cost basis - always delegates (doesn't change on closure).
   */
  get currentCostBasis(): bigint {
    return this._underlying.currentCostBasis;
  }

  /**
   * Realized PnL - always delegates (historical).
   */
  get realizedPnl(): bigint {
    return this._underlying.realizedPnl;
  }

  /**
   * Unrealized PnL - returns simulated PnL when triggered.
   */
  get unrealizedPnl(): bigint {
    return this.isEffectivelyTriggered ? this.simulatedPnL : this._underlying.unrealizedPnl;
  }

  /**
   * Realized cashflow - always delegates (historical).
   */
  get realizedCashflow(): bigint {
    return this._underlying.realizedCashflow;
  }

  /**
   * Unrealized cashflow - zeroed when triggered (position closed).
   */
  get unrealizedCashflow(): bigint {
    return this.isEffectivelyTriggered ? 0n : this._underlying.unrealizedCashflow;
  }

  // ============================================================================
  // PositionInterface - Fee Fields (always delegate)
  // ============================================================================

  get collectedFees(): bigint {
    return this._underlying.collectedFees;
  }

  get unClaimedFees(): bigint {
    return this._underlying.unClaimedFees;
  }

  get lastFeesCollectedAt(): Date {
    return this._underlying.lastFeesCollectedAt;
  }

  get totalApr(): number | null {
    return this._underlying.totalApr;
  }

  // ============================================================================
  // PositionInterface - Price Range (always delegate)
  // ============================================================================

  get priceRangeLower(): bigint {
    return this._underlying.priceRangeLower;
  }

  get priceRangeUpper(): bigint {
    return this._underlying.priceRangeUpper;
  }

  // ============================================================================
  // PositionInterface - Lifecycle (simulated when triggered)
  // ============================================================================

  get positionOpenedAt(): Date {
    return this._underlying.positionOpenedAt;
  }

  /**
   * Position closed at - returns current time when triggered.
   */
  get positionClosedAt(): Date | null {
    return this.isEffectivelyTriggered ? new Date() : this._underlying.positionClosedAt;
  }

  /**
   * Is active - returns false when triggered (simulating closure).
   */
  get isActive(): boolean {
    return this.isEffectivelyTriggered ? false : this._underlying.isActive;
  }

  // ============================================================================
  // PositionInterface - Protocol-specific (always delegate)
  // ============================================================================

  get config(): Record<string, unknown> {
    return this._underlying.config;
  }

  get state(): Record<string, unknown> {
    return this._underlying.state;
  }

  // ============================================================================
  // PositionInterface - Timestamps (always delegate)
  // ============================================================================

  get createdAt(): Date {
    return this._underlying.createdAt;
  }

  get updatedAt(): Date {
    return this._underlying.updatedAt;
  }

  // ============================================================================
  // PositionInterface - Methods
  // ============================================================================

  /**
   * Serialize to JSON with current (possibly simulated) values.
   */
  toJSON(): PositionJSON {
    return {
      id: this.id,
      positionHash: this.positionHash,
      userId: this.userId,
      protocol: this.protocol,
      positionType: this.positionType,
      pool: this.pool.toJSON(),
      isToken0Quote: this.isToken0Quote,

      // PnL fields (bigint -> string)
      currentValue: this.currentValue.toString(),
      currentCostBasis: this.currentCostBasis.toString(),
      realizedPnl: this.realizedPnl.toString(),
      unrealizedPnl: this.unrealizedPnl.toString(),
      realizedCashflow: this.realizedCashflow.toString(),
      unrealizedCashflow: this.unrealizedCashflow.toString(),

      // Fee fields
      collectedFees: this.collectedFees.toString(),
      unClaimedFees: this.unClaimedFees.toString(),
      lastFeesCollectedAt: this.lastFeesCollectedAt.toISOString(),
      totalApr: this.totalApr,

      // Price range
      priceRangeLower: this.priceRangeLower.toString(),
      priceRangeUpper: this.priceRangeUpper.toString(),

      // Lifecycle
      positionOpenedAt: this.positionOpenedAt.toISOString(),
      positionClosedAt: this.positionClosedAt?.toISOString() ?? null,
      isActive: this.isActive,

      // Protocol-specific
      config: this.config,
      state: this.state,

      // Timestamps
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get the base token (delegates to underlying).
   */
  getBaseToken(): Erc20Token {
    return this._underlying.getBaseToken();
  }

  /**
   * Get the quote token (delegates to underlying).
   */
  getQuoteToken(): Erc20Token {
    return this._underlying.getQuoteToken();
  }

  /**
   * Get total realized PnL including cashflow (delegates to underlying).
   */
  getTotalRealizedPnl(): bigint {
    return this._underlying.getTotalRealizedPnl();
  }

  /**
   * Get total unrealized PnL including accrued cashflow.
   * Returns simulated value when triggered.
   */
  getTotalUnrealizedPnl(): bigint {
    return this.isEffectivelyTriggered
      ? this.simulatedPnL // Cashflow is zeroed when triggered
      : this._underlying.getTotalUnrealizedPnl();
  }

  /**
   * Simulate PnL at a given price.
   *
   * Behavior by trigger state:
   * - IN_POSITION: Returns curved PnL from underlying position
   * - TP_TRIGGERED (with TP defined): Returns fixed PnL at TP price (flat line)
   * - SL_TRIGGERED (with SL defined): Returns fixed PnL at SL price (flat line)
   * - TP_TRIGGERED/SL_TRIGGERED (without trigger defined): Returns curved PnL (fallback)
   *
   * @param price - The base token price in quote token units
   * @returns The simulated PnL (fixed when effectively triggered, curved otherwise)
   */
  simulatePnLAtPrice(price: bigint): bigint {
    // If not effectively triggered (either IN_POSITION or trigger price is null),
    // return the normal curved PnL from underlying
    if (!this.isEffectivelyTriggered) {
      return this._underlying.simulatePnLAtPrice(price);
    }

    // When effectively triggered, return fixed PnL regardless of input price
    // This creates the flat horizontal line in the PnL curve
    return this.simulatedPnL;
  }
}
