/**
 * Close Order Simulation Overlay
 *
 * A decorator/wrapper class that wraps an underlying position and simulates
 * what happens when a take-profit (TP) or stop-loss (SL) trigger is hit.
 *
 * This is for UI simulation purposes only, not for real position tracking.
 * It allows the UI to visualize PnL curves with simulated trigger outcomes.
 *
 * The overlay is swap-config-aware: post-trigger curves reflect the actual
 * token composition based on the close order's swap configuration:
 * - HOLD_MIXED (no swap): value = baseAmount × price + quoteAmount (linear)
 * - ALL_BASE (swap to base): value = totalBase × price (linear, steeper)
 * - ALL_QUOTE (swap to quote): value = constant (flat line)
 */

import type { Erc20Token } from '../../token/index.js';
import type { UniswapV3Pool } from '../../pool/index.js';
import type { PositionInterface } from '../position.interface.js';
import type { PositionProtocol, PositionType, PositionJSON, PnLSimulationResult } from '../position.types.js';
import type { SwapConfig } from '../../automation/uniswapv3/uniswapv3-close-order-config.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Sentinel value for infinite maximum runup.
 * Returned when post-trigger curve has base token exposure (value grows
 * without bound as price increases). UI should render as ∞.
 */
export const INFINITE_RUNUP = (1n << 255n) - 1n;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Post-trigger token exposure after a close order executes.
 * - HOLD_MIXED: No swap performed — user retains both base and quote tokens
 * - ALL_QUOTE: Everything swapped to quote token — flat value line
 * - ALL_BASE: Everything swapped to base token — linear value line
 */
export type PostTriggerExposure = 'HOLD_MIXED' | 'ALL_QUOTE' | 'ALL_BASE';

/**
 * PnL curve scenario for visualization.
 * - combined: Current combined view (CL curve between triggers, post-trigger outside)
 * - sl_triggered: Post-SL curve for ALL prices (position closed at SL price)
 * - tp_triggered: Post-TP curve for ALL prices (position closed at TP price)
 */
export type PnLScenario = 'combined' | 'sl_triggered' | 'tp_triggered';

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
  /** Swap config for stop-loss order (undefined/null = no swap → HOLD_MIXED) */
  stopLossSwapConfig?: SwapConfig | null;
  /** Swap config for take-profit order (undefined/null = no swap → HOLD_MIXED) */
  takeProfitSwapConfig?: SwapConfig | null;
}

// ============================================================================
// CLASS
// ============================================================================

/**
 * CloseOrderSimulationOverlay
 *
 * Wraps an underlying position and simulates TP/SL trigger behavior
 * with swap-config-aware post-trigger curves.
 *
 * When plotting PnL curves, the post-trigger behavior depends on swap config:
 * - HOLD_MIXED: Linear curve based on frozen token amounts from trigger price
 * - ALL_BASE: Linear curve (all value converted to base token at trigger)
 * - ALL_QUOTE: Flat horizontal line (all value in quote token)
 *
 * @example
 * ```typescript
 * const overlay = new CloseOrderSimulationOverlay({
 *   underlyingPosition: position,
 *   takeProfitPrice: 2500n * 10n ** 6n,
 *   stopLossPrice: 1800n * 10n ** 6n,
 *   takeProfitSwapConfig: { enabled: true, direction: 'TOKEN0_TO_1', slippageBps: 50 },
 *   stopLossSwapConfig: null, // no swap → HOLD_MIXED
 * });
 *
 * // Below SL: linear curve (HOLD_MIXED — both tokens held)
 * overlay.simulatePnLAtPrice(1500n * 10n ** 6n);
 *
 * // Between SL and TP: normal curved PnL
 * overlay.simulatePnLAtPrice(2000n * 10n ** 6n);
 *
 * // Above TP: depends on swap config
 * overlay.simulatePnLAtPrice(3000n * 10n ** 6n);
 * ```
 */
export class CloseOrderSimulationOverlay implements PositionInterface {
  private readonly _underlying: PositionInterface;
  private readonly _takeProfitPrice: bigint | null;
  private readonly _stopLossPrice: bigint | null;
  private readonly _slSwapConfig: SwapConfig | null;
  private readonly _tpSwapConfig: SwapConfig | null;

  // Cached simulated results at trigger prices (calculated lazily)
  // undefined = not calculated yet
  private _cachedResultAtTP: PnLSimulationResult | undefined = undefined;
  private _cachedResultAtSL: PnLSimulationResult | undefined = undefined;

  constructor(params: CloseOrderSimulationOverlayParams) {
    this._underlying = params.underlyingPosition;
    this._takeProfitPrice = params.takeProfitPrice;
    this._stopLossPrice = params.stopLossPrice;
    this._slSwapConfig = params.stopLossSwapConfig ?? null;
    this._tpSwapConfig = params.takeProfitSwapConfig ?? null;
  }

  // ============================================================================
  // Trigger Price Access
  // ============================================================================

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
  // Swap Config Exposure Resolution
  // ============================================================================

  /**
   * Resolve a SwapConfig to post-trigger exposure semantics.
   *
   * Maps SwapDirection (token0/token1 terminology) to quote/base semantics
   * using isToken0Quote:
   *
   * isToken0Quote=true  → token0=quote, token1=base:
   *   TOKEN0_TO_1 = selling quote, buying base → ALL_BASE
   *   TOKEN1_TO_0 = selling base, buying quote → ALL_QUOTE
   *
   * isToken0Quote=false → token0=base, token1=quote:
   *   TOKEN0_TO_1 = selling base, buying quote → ALL_QUOTE
   *   TOKEN1_TO_0 = selling quote, buying base → ALL_BASE
   */
  private static resolveExposure(
    swapConfig: SwapConfig | null | undefined,
    isToken0Quote: boolean,
  ): PostTriggerExposure {
    if (!swapConfig || !swapConfig.enabled) return 'HOLD_MIXED';

    const { direction } = swapConfig;
    if (isToken0Quote) {
      return direction === 'TOKEN0_TO_1' ? 'ALL_BASE' : 'ALL_QUOTE';
    } else {
      return direction === 'TOKEN0_TO_1' ? 'ALL_QUOTE' : 'ALL_BASE';
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get the cached simulation result at take-profit price (lazy calculation).
   * Returns null if TP is not configured.
   */
  private get resultAtTP(): PnLSimulationResult | null {
    if (this._takeProfitPrice === null) {
      return null;
    }
    if (this._cachedResultAtTP === undefined) {
      this._cachedResultAtTP = this._underlying.simulatePnLAtPrice(this._takeProfitPrice);
    }
    return this._cachedResultAtTP;
  }

  /**
   * Get the cached simulation result at stop-loss price (lazy calculation).
   * Returns null if SL is not configured.
   */
  private get resultAtSL(): PnLSimulationResult | null {
    if (this._stopLossPrice === null) {
      return null;
    }
    if (this._cachedResultAtSL === undefined) {
      this._cachedResultAtSL = this._underlying.simulatePnLAtPrice(this._stopLossPrice);
    }
    return this._cachedResultAtSL;
  }

  /**
   * Compute post-trigger PnL result at a given price based on swap config.
   *
   * Three modes:
   * - HOLD_MIXED: value(P) = baseAmount × P / 10^baseDecimals + quoteAmount
   * - ALL_BASE:   value(P) = positionValue(trigger) × P / triggerPrice
   * - ALL_QUOTE:  value(P) = positionValue(trigger) (flat)
   */
  private computePostTriggerResult(
    price: bigint,
    triggerPrice: bigint,
    swapConfig: SwapConfig | null | undefined,
  ): PnLSimulationResult {
    const exposure = CloseOrderSimulationOverlay.resolveExposure(
      swapConfig,
      this._underlying.isToken0Quote,
    );

    // Get cached result at the trigger price
    const resultAtTrigger = triggerPrice === this._stopLossPrice
      ? this.resultAtSL
      : this.resultAtTP;

    if (resultAtTrigger === null) {
      return this._underlying.simulatePnLAtPrice(price);
    }

    let positionValue: bigint;

    switch (exposure) {
      case 'ALL_QUOTE': {
        // Flat line: all value in quote tokens
        positionValue = resultAtTrigger.positionValue;
        break;
      }
      case 'ALL_BASE': {
        // Linear in price: all converted to base tokens at trigger price
        // totalBase = positionValue(trigger) / triggerPrice
        // value(P) = totalBase × P = positionValue(trigger) × P / triggerPrice
        positionValue = (resultAtTrigger.positionValue * price) / triggerPrice;
        break;
      }
      case 'HOLD_MIXED': {
        // Mixed: base + quote tokens held from trigger snapshot
        const baseAmt = resultAtTrigger.baseTokenAmount;
        const quoteAmt = resultAtTrigger.quoteTokenAmount;

        if (baseAmt !== undefined && quoteAmt !== undefined) {
          // value(P) = baseAmt × price / 10^baseDecimals + quoteAmt
          // price is in "quote smallest units per 1 whole base token"
          // baseAmt is in base smallest units (e.g., wei)
          const baseDecimals = this._underlying.getBaseToken().decimals;
          const baseDivisor = 10n ** BigInt(baseDecimals);
          positionValue = (baseAmt * price) / baseDivisor + quoteAmt;
        } else {
          // Fallback for non-UniswapV3 protocols: use flat line
          positionValue = resultAtTrigger.positionValue;
        }
        break;
      }
    }

    const costBasis = this._underlying.currentCostBasis;
    const pnlValue = positionValue - costBasis;
    const pnlPercent = costBasis > 0n
      ? Number((pnlValue * 1000000n) / costBasis) / 10000
      : 0;

    return { positionValue, pnlValue, pnlPercent };
  }

  /**
   * Find the minimum position value across the combined curve.
   * Evaluates at critical price points where extremes can occur.
   */
  private findMinPositionValue(): bigint {
    const candidates: bigint[] = [];

    // Left edge: evaluate at smallest positive price (P → 0)
    candidates.push(this.simulatePnLAtPrice(1n).positionValue);

    // SL boundary
    if (this._stopLossPrice !== null) {
      candidates.push(this.simulatePnLAtPrice(this._stopLossPrice).positionValue);
    }

    // TP boundary
    if (this._takeProfitPrice !== null) {
      candidates.push(this.simulatePnLAtPrice(this._takeProfitPrice).positionValue);
    }

    // Lower and upper range boundaries (CL curve extremes are at range edges)
    const lowerRange = this._underlying.priceRangeLower;
    if (lowerRange > 0n) {
      candidates.push(this.simulatePnLAtPrice(lowerRange).positionValue);
    }
    const upperRange = this._underlying.priceRangeUpper;
    if (upperRange > 0n) {
      candidates.push(this.simulatePnLAtPrice(upperRange).positionValue);
    }

    return candidates.reduce((min, v) => v < min ? v : min, candidates[0]!);
  }

  /**
   * Find the maximum position value across the combined curve (when finite).
   * Evaluates at critical price points where extremes can occur.
   */
  private findMaxPositionValue(): bigint {
    const candidates: bigint[] = [];

    // Current value
    candidates.push(this._underlying.currentValue);

    // TP boundary (if exists)
    if (this._takeProfitPrice !== null) {
      candidates.push(this.simulatePnLAtPrice(this._takeProfitPrice).positionValue);
    }

    // Above range — position is all-quote, constant value
    // Use upper range × 2 as proxy for "well above range"
    const aboveRange = this._underlying.priceRangeUpper * 2n;
    if (aboveRange > 0n) {
      candidates.push(this.simulatePnLAtPrice(aboveRange).positionValue);
    }

    // Upper range boundary
    const upperRange = this._underlying.priceRangeUpper;
    if (upperRange > 0n) {
      candidates.push(this.simulatePnLAtPrice(upperRange).positionValue);
    }

    return candidates.reduce((max, v) => v > max ? v : max, candidates[0]!);
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
  // PositionInterface - PnL Fields (always delegate)
  // ============================================================================

  get currentValue(): bigint {
    return this._underlying.currentValue;
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

  get unrealizedPnl(): bigint {
    return this._underlying.unrealizedPnl;
  }

  /**
   * Realized cashflow - always delegates (historical).
   */
  get realizedCashflow(): bigint {
    return this._underlying.realizedCashflow;
  }

  get unrealizedCashflow(): bigint {
    return this._underlying.unrealizedCashflow;
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
  // PositionInterface - Lifecycle (always delegate)
  // ============================================================================

  get positionOpenedAt(): Date {
    return this._underlying.positionOpenedAt;
  }

  get positionClosedAt(): Date | null {
    return this._underlying.positionClosedAt;
  }

  get isActive(): boolean {
    return this._underlying.isActive;
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

  getTotalUnrealizedPnl(): bigint {
    return this._underlying.getTotalUnrealizedPnl();
  }

  /**
   * Simulate position at a given price.
   *
   * Automatically determines trigger effects based on the price parameter
   * and computes post-trigger value using the swap config:
   *
   * - If price <= stopLossPrice (and SL defined): Post-SL curve based on swap config
   * - If price >= takeProfitPrice (and TP defined): Post-TP curve based on swap config
   * - Otherwise: Returns curved result from underlying position
   *
   * Post-trigger curve shapes:
   * - HOLD_MIXED (no swap): value = baseAmount × price + quoteAmount (linear)
   * - ALL_BASE (swap to base): value = totalBase × price (linear)
   * - ALL_QUOTE (swap to quote): value = constant (flat line)
   *
   * @param price - The base token price in quote token units
   * @returns Simulation result with swap-config-aware post-trigger values
   */
  simulatePnLAtPrice(price: bigint): PnLSimulationResult {
    // Check stop-loss trigger (price falls below SL)
    if (this._stopLossPrice !== null && price <= this._stopLossPrice) {
      return this.computePostTriggerResult(price, this._stopLossPrice, this._slSwapConfig);
    }

    // Check take-profit trigger (price rises above TP)
    if (this._takeProfitPrice !== null && price >= this._takeProfitPrice) {
      return this.computePostTriggerResult(price, this._takeProfitPrice, this._tpSwapConfig);
    }

    // In-position: delegate to underlying
    return this._underlying.simulatePnLAtPrice(price);
  }

  /**
   * Simulate PnL at a given price for a specific scenario.
   *
   * - 'combined': Current behavior — CL curve between triggers, post-trigger outside
   * - 'sl_triggered': Post-SL curve for ALL prices (position closed at SL price)
   * - 'tp_triggered': Post-TP curve for ALL prices (position closed at TP price)
   */
  simulateScenario(price: bigint, scenario: PnLScenario): PnLSimulationResult {
    switch (scenario) {
      case 'sl_triggered':
        if (this._stopLossPrice === null) return this._underlying.simulatePnLAtPrice(price);
        return this.computePostTriggerResult(price, this._stopLossPrice, this._slSwapConfig);
      case 'tp_triggered':
        if (this._takeProfitPrice === null) return this._underlying.simulatePnLAtPrice(price);
        return this.computePostTriggerResult(price, this._takeProfitPrice, this._tpSwapConfig);
      case 'combined':
      default:
        return this.simulatePnLAtPrice(price);
    }
  }

  // ============================================================================
  // Risk Metrics
  // ============================================================================

  /**
   * Maximum drawdown across the combined PnL curve.
   * Returns costBasis - min(value(P)) for all P >= 0.
   * Always finite (bounded by costBasis).
   */
  maxDrawdown(): bigint {
    const costBasis = this._underlying.currentCostBasis;
    const minValue = this.findMinPositionValue();
    const drawdown = costBasis - minValue;
    return drawdown > 0n ? drawdown : 0n;
  }

  /**
   * Maximum runup across the combined PnL curve.
   * Returns max(value(P)) - costBasis for all P >= 0.
   * Returns INFINITE_RUNUP when any post-trigger segment has base token exposure
   * (ALL_BASE or HOLD_MIXED on the TP side), since value grows without bound.
   */
  maxRunup(): bigint {
    const costBasis = this._underlying.currentCostBasis;

    // Check if the right side (TP) has base token exposure → infinite
    if (this._takeProfitPrice !== null) {
      const tpExposure = CloseOrderSimulationOverlay.resolveExposure(
        this._tpSwapConfig,
        this._underlying.isToken0Quote,
      );
      if (tpExposure !== 'ALL_QUOTE') {
        return INFINITE_RUNUP;
      }
    }

    // If no TP: underlying above-range holds only quote tokens (finite constant).
    // If TP with ALL_QUOTE: also finite.
    const maxValue = this.findMaxPositionValue();
    const runup = maxValue - costBasis;
    return runup > 0n ? runup : 0n;
  }
}
