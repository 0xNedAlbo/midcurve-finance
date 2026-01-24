/**
 * Uniswap V3 Position
 *
 * Concrete position implementation for Uniswap V3 protocol.
 * Extends BasePosition with Uniswap V3 specific configuration and state.
 */

import { BasePosition } from '../base-position.js';
import type { UniswapV3Pool } from '../../pool/index.js';
import type {
  PositionProtocol,
  PositionType,
  BasePositionParams,
  PositionRow,
} from '../position.types.js';
import {
  UniswapV3PositionConfig,
  type UniswapV3PositionConfigJSON,
} from './uniswapv3-position-config.js';
import {
  type UniswapV3PositionState,
  type UniswapV3PositionStateJSON,
  positionStateToJSON,
  positionStateFromJSON,
} from './uniswapv3-position-state.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Parameters for constructing a UniswapV3Position.
 */
export interface UniswapV3PositionParams extends BasePositionParams {
  config: UniswapV3PositionConfig;
  state: UniswapV3PositionState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for UniswapV3Position factory method.
 * Extends PositionRow with protocol narrowed to 'uniswapv3'.
 */
export interface UniswapV3PositionRow extends PositionRow {
  protocol: 'uniswapv3';
}

// ============================================================================
// POSITION CLASS
// ============================================================================

/**
 * UniswapV3Position
 *
 * Represents a Uniswap V3 concentrated liquidity position.
 * Provides type-safe access to Uniswap V3 specific configuration and state.
 *
 * @example
 * ```typescript
 * // From database
 * const position = UniswapV3Position.fromDB(row, pool);
 *
 * // Access typed config
 * console.log(position.chainId);     // 1
 * console.log(position.nftId);       // 123456
 * console.log(position.tickUpper);   // 202920
 * console.log(position.tickLower);   // 202820
 *
 * // Access typed state
 * console.log(position.liquidity);   // bigint
 * console.log(position.ownerAddress); // '0x...'
 *
 * // Access position values
 * console.log(position.currentValue);     // bigint in quote tokens
 * console.log(position.getTotalRealizedPnl()); // bigint
 *
 * // Get tokens
 * const baseToken = position.getBaseToken();
 * const quoteToken = position.getQuoteToken();
 *
 * // For API response
 * return createSuccessResponse(position.toJSON());
 * ```
 */
export class UniswapV3Position extends BasePosition {
  readonly protocol: PositionProtocol = 'uniswapv3';

  private readonly _config: UniswapV3PositionConfig;
  private readonly _state: UniswapV3PositionState;

  constructor(params: UniswapV3PositionParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Config Accessors (PositionInterface compliance)
  // ============================================================================

  /**
   * Get config as generic Record (for PositionInterface compliance).
   */
  get config(): Record<string, unknown> {
    return this._config.toJSON() as unknown as Record<string, unknown>;
  }

  /**
   * Get state as generic Record (for PositionInterface compliance).
   * Converts bigint values to strings.
   */
  get state(): Record<string, unknown> {
    return positionStateToJSON(this._state) as unknown as Record<
      string,
      unknown
    >;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  /**
   * Get strongly-typed config for internal use.
   */
  get typedConfig(): UniswapV3PositionConfig {
    return this._config;
  }

  /**
   * Get strongly-typed state for internal use.
   */
  get typedState(): UniswapV3PositionState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors - Config
  // ============================================================================

  /** Chain ID where the position exists */
  get chainId(): number {
    return this._config.chainId;
  }

  /** NFT token ID */
  get nftId(): number {
    return this._config.nftId;
  }

  /** Pool address on the blockchain */
  get poolAddress(): string {
    return this._config.poolAddress;
  }

  /** Upper tick bound */
  get tickUpper(): number {
    return this._config.tickUpper;
  }

  /** Lower tick bound */
  get tickLower(): number {
    return this._config.tickLower;
  }

  // ============================================================================
  // Convenience Accessors - State
  // ============================================================================

  /** Owner address (wallet that owns the NFT) */
  get ownerAddress(): string {
    return this._state.ownerAddress;
  }

  /** Amount of liquidity in the position */
  get liquidity(): bigint {
    return this._state.liquidity;
  }

  /** Fee growth inside for token0 (Q128.128 fixed point) */
  get feeGrowthInside0LastX128(): bigint {
    return this._state.feeGrowthInside0LastX128;
  }

  /** Fee growth inside for token1 (Q128.128 fixed point) */
  get feeGrowthInside1LastX128(): bigint {
    return this._state.feeGrowthInside1LastX128;
  }

  /** Uncollected fees owed in token0 */
  get tokensOwed0(): bigint {
    return this._state.tokensOwed0;
  }

  /** Uncollected fees owed in token1 */
  get tokensOwed1(): bigint {
    return this._state.tokensOwed1;
  }

  /** Unclaimed fees in token0 (more accurate than tokensOwed0) */
  get unclaimedFees0(): bigint {
    return this._state.unclaimedFees0;
  }

  /** Unclaimed fees in token1 (more accurate than tokensOwed1) */
  get unclaimedFees1(): bigint {
    return this._state.unclaimedFees1;
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create UniswapV3Position from database row.
   *
   * @param row - Database row from Prisma
   * @param pool - UniswapV3Pool instance (must be pre-loaded)
   * @returns UniswapV3Position instance
   */
  static fromDB(
    row: UniswapV3PositionRow,
    pool: UniswapV3Pool
  ): UniswapV3Position {
    const configJSON = row.config as unknown as UniswapV3PositionConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3PositionStateJSON;

    return new UniswapV3Position({
      // Identity
      id: row.id,
      positionHash: row.positionHash,
      userId: row.userId,
      positionType: row.positionType as PositionType,

      // Pool reference
      pool,
      isToken0Quote: row.isToken0Quote,

      // PnL fields
      currentValue: row.currentValue,
      currentCostBasis: row.currentCostBasis,
      realizedPnl: row.realizedPnl,
      unrealizedPnl: row.unrealizedPnl,
      realizedCashflow: row.realizedCashflow,
      unrealizedCashflow: row.unrealizedCashflow,

      // Fee fields
      collectedFees: row.collectedFees,
      unClaimedFees: row.unClaimedFees,
      lastFeesCollectedAt: row.lastFeesCollectedAt,
      totalApr: row.totalApr,

      // Price range
      priceRangeLower: row.priceRangeLower,
      priceRangeUpper: row.priceRangeUpper,

      // Lifecycle
      positionOpenedAt: row.positionOpenedAt,
      positionClosedAt: row.positionClosedAt,
      isActive: row.isActive,

      // Protocol-specific
      config: UniswapV3PositionConfig.fromJSON(configJSON),
      state: positionStateFromJSON(stateJSON),

      // Timestamps
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
