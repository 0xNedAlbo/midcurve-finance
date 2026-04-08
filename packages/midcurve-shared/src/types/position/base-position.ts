/**
 * Abstract Base Position
 *
 * Base class for protocol-specific position implementations.
 * Provides common functionality and enforces the PositionInterface contract.
 *
 * Protocol implementations (e.g., UniswapV3Position) must extend this class
 * and implement abstract methods for protocol-specific behavior.
 */

import type { TokenInterface } from '../token/index.js';
import type { PoolInterface } from '../pool/index.js';
import type { PositionInterface } from './position.interface.js';
import type {
  PositionProtocol,
  PositionType,
  PositionJSON,
  BasePositionParams,
  PnLSimulationResult,
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

  // ============================================================================
  // Token & Pool Reference
  // ============================================================================

  readonly token0: TokenInterface;
  readonly token1: TokenInterface;

  // ============================================================================
  // PnL Fields
  // ============================================================================

  readonly currentValue: bigint;
  readonly costBasis: bigint;
  readonly realizedPnl: bigint;
  readonly unrealizedPnl: bigint;
  readonly realizedCashflow: bigint;
  readonly unrealizedCashflow: bigint;

  // ============================================================================
  // Yield Fields
  // ============================================================================

  readonly collectedYield: bigint;
  readonly unclaimedYield: bigint;
  readonly lastYieldClaimedAt: Date;

  // ============================================================================
  // APR Fields
  // ============================================================================

  readonly baseApr: number | null;
  readonly rewardApr: number | null;
  readonly totalApr: number | null;

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
  readonly type: PositionType;

  /**
   * Virtual pool constructed from position data.
   * Subclasses implement this to build a pool from their config/state/tokens.
   */
  abstract get pool(): PoolInterface;

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
   * Simulate the position at a given price.
   * Must be implemented by protocol-specific subclasses.
   *
   * @param price - The base token price in quote token units (scaled by quote token decimals)
   * @returns Full simulation result including value, PnL, and percent
   */
  abstract simulatePnLAtPrice(price: bigint): PnLSimulationResult;

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
    this.type = params.type as PositionType;

    // Token & pool reference
    this.token0 = params.token0;
    this.token1 = params.token1;

    // PnL fields
    this.currentValue = params.currentValue;
    this.costBasis = params.costBasis;
    this.realizedPnl = params.realizedPnl;
    this.unrealizedPnl = params.unrealizedPnl;
    this.realizedCashflow = params.realizedCashflow;
    this.unrealizedCashflow = params.unrealizedCashflow;

    // Yield fields
    this.collectedYield = params.collectedYield;
    this.unclaimedYield = params.unclaimedYield;
    this.lastYieldClaimedAt = params.lastYieldClaimedAt;

    // APR fields
    this.baseApr = params.baseApr;
    this.rewardApr = params.rewardApr;
    this.totalApr = params.totalApr;

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
  toJSON(): Omit<PositionJSON, 'isToken0Quote' | 'priceRangeLower' | 'priceRangeUpper'> {
    return {
      id: this.id,
      positionHash: this.positionHash,
      userId: this.userId,
      protocol: this.protocol,
      type: this.type,
      pool: this.pool.toJSON(),

      // PnL fields (bigint → string)
      currentValue: this.currentValue.toString(),
      costBasis: this.costBasis.toString(),
      realizedPnl: this.realizedPnl.toString(),
      unrealizedPnl: this.unrealizedPnl.toString(),
      realizedCashflow: this.realizedCashflow.toString(),
      unrealizedCashflow: this.unrealizedCashflow.toString(),

      // Yield fields
      collectedYield: this.collectedYield.toString(),
      unclaimedYield: this.unclaimedYield.toString(),
      lastYieldClaimedAt: this.lastYieldClaimedAt?.toISOString() ?? null,

      // APR fields
      baseApr: this.baseApr,
      rewardApr: this.rewardApr,
      totalApr: this.totalApr,

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
