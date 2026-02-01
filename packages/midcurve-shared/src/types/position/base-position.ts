/**
 * Abstract Base Position
 *
 * Base class for protocol-specific position implementations.
 * Provides common functionality and enforces the PositionInterface contract.
 *
 * Protocol implementations (e.g., UniswapV3Position) must extend this class
 * and implement abstract methods for protocol-specific behavior.
 */

import type { Erc20Token } from '../token/index.js';
import type { UniswapV3Pool } from '../pool/index.js';
import type { PositionInterface } from './position.interface.js';
import type {
  PositionProtocol,
  PositionType,
  PositionJSON,
  BasePositionParams,
} from './position.types.js';

/**
 * BasePosition
 *
 * Abstract base class implementing PositionInterface.
 * Concrete position types (UniswapV3Position, etc.) extend this class.
 *
 * @example
 * ```typescript
 * class UniswapV3Position extends BasePosition {
 *   readonly protocol: PositionProtocol = 'uniswapv3';
 *   // ... protocol-specific implementation
 * }
 * ```
 */
export abstract class BasePosition implements PositionInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  readonly id: string;
  readonly positionHash: string;
  readonly userId: string;
  readonly positionType: PositionType;

  // ============================================================================
  // Pool Reference
  // ============================================================================

  readonly pool: UniswapV3Pool;
  readonly isToken0Quote: boolean;

  // ============================================================================
  // PnL Fields
  // ============================================================================

  readonly currentValue: bigint;
  readonly currentCostBasis: bigint;
  readonly realizedPnl: bigint;
  readonly unrealizedPnl: bigint;
  readonly realizedCashflow: bigint;
  readonly unrealizedCashflow: bigint;

  // ============================================================================
  // Fee Fields
  // ============================================================================

  readonly collectedFees: bigint;
  readonly unClaimedFees: bigint;
  readonly lastFeesCollectedAt: Date;
  readonly totalApr: number | null;

  // ============================================================================
  // Price Range
  // ============================================================================

  readonly priceRangeLower: bigint;
  readonly priceRangeUpper: bigint;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  readonly positionOpenedAt: Date;
  readonly positionClosedAt: Date | null;
  readonly isActive: boolean;

  // ============================================================================
  // Timestamps
  // ============================================================================

  readonly createdAt: Date;
  readonly updatedAt: Date;

  // ============================================================================
  // Abstract Properties (must be implemented by subclasses)
  // ============================================================================

  /**
   * Protocol identifier - must be implemented by subclass.
   */
  abstract readonly protocol: PositionProtocol;

  /**
   * Get config as generic Record (for PositionInterface compliance).
   * Subclasses implement this to return their typed config as Record.
   */
  abstract get config(): Record<string, unknown>;

  /**
   * Get state as generic Record (for PositionInterface compliance).
   * Subclasses implement this to return their typed state as Record.
   */
  abstract get state(): Record<string, unknown>;

  /**
   * Simulate the position's PnL at a given price.
   * Must be implemented by protocol-specific subclasses.
   *
   * @param price - The base token price in quote token units (scaled by quote token decimals)
   * @returns The simulated PnL at the given price in quote token units
   */
  abstract simulatePnLAtPrice(price: bigint): bigint;

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Creates a new BasePosition instance.
   *
   * @param params - Base position parameters
   */
  constructor(params: BasePositionParams) {
    // Identity
    this.id = params.id;
    this.positionHash = params.positionHash;
    this.userId = params.userId;
    this.positionType = params.positionType;

    // Pool reference
    this.pool = params.pool;
    this.isToken0Quote = params.isToken0Quote;

    // PnL fields
    this.currentValue = params.currentValue;
    this.currentCostBasis = params.currentCostBasis;
    this.realizedPnl = params.realizedPnl;
    this.unrealizedPnl = params.unrealizedPnl;
    this.realizedCashflow = params.realizedCashflow;
    this.unrealizedCashflow = params.unrealizedCashflow;

    // Fee fields
    this.collectedFees = params.collectedFees;
    this.unClaimedFees = params.unClaimedFees;
    this.lastFeesCollectedAt = params.lastFeesCollectedAt;
    this.totalApr = params.totalApr;

    // Price range
    this.priceRangeLower = params.priceRangeLower;
    this.priceRangeUpper = params.priceRangeUpper;

    // Lifecycle
    this.positionOpenedAt = params.positionOpenedAt;
    this.positionClosedAt = params.positionClosedAt;
    this.isActive = params.isActive;

    // Timestamps
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  /**
   * Serialize position to JSON format for API responses.
   *
   * Converts:
   * - Date objects to ISO 8601 strings
   * - bigint values to strings
   * - Pool to PoolJSON (via pool.toJSON())
   *
   * @returns PositionJSON ready for API response
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

      // PnL fields (bigint → string)
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

      // Price range (bigint → string)
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

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get the base token (the token with price risk exposure).
   *
   * In quote/base terminology:
   * - Quote token = reference currency (what you measure value in)
   * - Base token = asset being priced (what you have exposure to)
   *
   * @returns The base token (Erc20Token)
   */
  getBaseToken(): Erc20Token {
    return this.isToken0Quote ? this.pool.token1 : this.pool.token0;
  }

  /**
   * Get the quote token (the reference/numeraire token).
   *
   * @returns The quote token (Erc20Token)
   */
  getQuoteToken(): Erc20Token {
    return this.isToken0Quote ? this.pool.token0 : this.pool.token1;
  }

  /**
   * Get total realized PnL including cashflow.
   *
   * For AMM positions, realizedCashflow is typically 0.
   * For perpetuals/lending, it includes funding/interest.
   *
   * @returns Total realized PnL as bigint
   */
  getTotalRealizedPnl(): bigint {
    return this.realizedPnl + this.realizedCashflow;
  }

  /**
   * Get total unrealized PnL including accrued cashflow.
   *
   * @returns Total unrealized PnL as bigint
   */
  getTotalUnrealizedPnl(): bigint {
    return this.unrealizedPnl + this.unrealizedCashflow;
  }
}
