/**
 * Uniswap V3 Position
 *
 * Concrete position implementation for Uniswap V3 protocol.
 * Extends BasePosition with Uniswap V3 specific configuration and state.
 */

import { TickMath } from '@uniswap/v3-sdk';
import { BasePosition } from '../base-position.js';
import { UniswapV3Pool } from '../../pool/index.js';
import type {
  PositionProtocol,
  PositionType,
  BasePositionParams,
  PositionRow,
  PnLSimulationResult,
  PositionJSON,
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
import { calculatePositionValue, getTokenAmountsFromLiquidity_X96 } from '../../../utils/uniswapv3/liquidity.js';
import { priceToSqrtRatioX96 } from '../../../utils/uniswapv3/price.js';
import type { PositionPhase } from '../../../utils/uniswapv3/types.js';

// ============================================================================
// PNL SIMULATION RESULT
// ============================================================================

/**
 * UniswapV3-specific simulation result with token amounts.
 * Extends base PnLSimulationResult with protocol-specific data.
 */
export interface UniswapV3PnLSimulationResult extends PnLSimulationResult {
  /** Amount of base token held at this price */
  baseTokenAmount: bigint;
  /** Amount of quote token held at this price */
  quoteTokenAmount: bigint;
  /** Position phase relative to range */
  phase: PositionPhase;
}

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

/**
 * Parameters for creating a simulation position (no database required).
 */
export interface UniswapV3SimulationParams {
  pool: UniswapV3Pool;
  isToken0Quote: boolean;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  costBasis: bigint;
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
  // PnL Simulation
  // ============================================================================

  /**
   * Simulate the position at a given price.
   * Used for interactive PnL curve visualization.
   *
   * @param price - The base token price in quote token units (scaled by quote token decimals)
   * @returns Full simulation result including value, PnL, percent, and token amounts
   */
  simulatePnLAtPrice(price: bigint): UniswapV3PnLSimulationResult {
    const baseToken = this.getBaseToken();
    const quoteToken = this.getQuoteToken();
    const baseIsToken0 = !this.isToken0Quote;

    // Convert price → sqrtPriceX96 DIRECTLY (continuous, no tick snapping)
    // This avoids the stair-step artifacts caused by nearestUsableTick() quantization
    const sqrtPriceJSBI = priceToSqrtRatioX96(
      baseToken.address,
      quoteToken.address,
      baseToken.decimals,
      price
    );
    const sqrtPriceX96 = BigInt(sqrtPriceJSBI.toString());

    // Calculate position value using continuous sqrtPrice
    const positionValue = calculatePositionValue(
      this.liquidity,
      sqrtPriceX96,
      this.tickLower,
      this.tickUpper,
      baseIsToken0
    );

    // Calculate PnL with higher precision (0.0001% resolution instead of 0.01%)
    const pnlValue = positionValue - this.currentCostBasis;
    const pnlPercent = this.currentCostBasis > 0n
      ? Number((pnlValue * 1000000n) / this.currentCostBasis) / 10000
      : 0;

    // Get tick-boundary sqrtPrices for token amounts and phase detection
    const sqrtPriceLowerX96 = BigInt(TickMath.getSqrtRatioAtTick(this.tickLower).toString());
    const sqrtPriceUpperX96 = BigInt(TickMath.getSqrtRatioAtTick(this.tickUpper).toString());

    // Get token amounts using continuous sqrtPrice
    const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity_X96(
      this.liquidity,
      sqrtPriceX96,
      sqrtPriceLowerX96,
      sqrtPriceUpperX96
    );

    // Map to base/quote based on token order
    const baseTokenAmount = baseIsToken0 ? token0Amount : token1Amount;
    const quoteTokenAmount = baseIsToken0 ? token1Amount : token0Amount;

    // Determine phase by comparing sqrtPrices directly (no tick conversion for hypothetical price)
    let phase: PositionPhase;
    if (sqrtPriceX96 < sqrtPriceLowerX96) {
      phase = 'below';
    } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
      phase = 'above';
    } else {
      phase = 'in-range';
    }

    return {
      positionValue,
      pnlValue,
      pnlPercent,
      baseTokenAmount,
      quoteTokenAmount,
      phase,
    };
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

  /**
   * Create a position for simulation purposes.
   * Does not require database identity fields - uses placeholder values.
   *
   * Use this factory when you need to simulate PnL curves for positions
   * that don't yet exist (e.g., in a wizard or preview mode).
   *
   * @param params - Simulation parameters (pool, ticks, liquidity, cost basis)
   * @returns UniswapV3Position instance suitable for simulation
   *
   * @example
   * ```typescript
   * const simulationPosition = UniswapV3Position.forSimulation({
   *   pool: discoveredPool,
   *   isToken0Quote: true,
   *   tickLower: 200000,
   *   tickUpper: 210000,
   *   liquidity: 1000000n,
   *   costBasis: 5000000000n, // 5000 USDC (6 decimals)
   * });
   *
   * // Use for PnL curve generation
   * const result = simulationPosition.simulatePnLAtPrice(2000000000n);
   * console.log(result.pnlPercent); // -5.23
   * ```
   */
  static forSimulation(params: UniswapV3SimulationParams): UniswapV3Position {
    const now = new Date();

    return new UniswapV3Position({
      // Identity (placeholder values for simulation)
      id: 'simulation',
      positionHash: 'simulation',
      userId: 'simulation',
      positionType: 'CL_TICKS',

      // Pool reference
      pool: params.pool,
      isToken0Quote: params.isToken0Quote,

      // PnL fields (costBasis is the key input)
      currentValue: params.costBasis, // At creation, value equals cost
      currentCostBasis: params.costBasis,
      realizedPnl: 0n,
      unrealizedPnl: 0n,
      realizedCashflow: 0n,
      unrealizedCashflow: 0n,

      // Fee fields (not used in simulation)
      collectedFees: 0n,
      unClaimedFees: 0n,
      lastFeesCollectedAt: now,
      totalApr: null,

      // Price range (placeholder - actual calculation uses ticks)
      priceRangeLower: 0n,
      priceRangeUpper: 0n,

      // Lifecycle
      positionOpenedAt: now,
      positionClosedAt: null,
      isActive: true,

      // Protocol-specific
      config: new UniswapV3PositionConfig({
        chainId: params.pool.chainId,
        nftId: 0, // Placeholder for simulation
        poolAddress: params.pool.address,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
      }),
      state: {
        ownerAddress: '0x0000000000000000000000000000000000000000',
        operator: '0x0000000000000000000000000000000000000000',
        liquidity: params.liquidity,
        feeGrowthInside0LastX128: 0n,
        feeGrowthInside1LastX128: 0n,
        tokensOwed0: 0n,
        tokensOwed1: 0n,
        unclaimedFees0: 0n,
        unclaimedFees1: 0n,
        tickLowerFeeGrowthOutside0X128: 0n,
        tickLowerFeeGrowthOutside1X128: 0n,
        tickUpperFeeGrowthOutside0X128: 0n,
        tickUpperFeeGrowthOutside1X128: 0n,
        isBurned: false,
        isClosed: false,
      },

      // Timestamps
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Create UniswapV3Position from JSON (API response).
   *
   * Deserializes a PositionJSON object back into a UniswapV3Position instance.
   * Recursively reconstructs nested pool and token instances.
   * Converts string representations back to bigint and Date types.
   *
   * @param json - JSON data from API response
   * @returns UniswapV3Position instance
   * @throws Error if protocol is not 'uniswapv3'
   *
   * @example
   * ```typescript
   * const response = await fetch('/api/v1/positions/...');
   * const json = await response.json();
   * const position = UniswapV3Position.fromJSON(json.data);
   *
   * // Class methods now work
   * const result = position.simulatePnLAtPrice(2000000000n);
   * console.log(result.pnlPercent);
   * ```
   */
  static fromJSON(json: PositionJSON): UniswapV3Position {
    if (json.protocol !== 'uniswapv3') {
      throw new Error(`Expected protocol 'uniswapv3', got '${json.protocol}'`);
    }

    return new UniswapV3Position({
      // Identity
      id: json.id,
      positionHash: json.positionHash,
      userId: json.userId,
      positionType: json.positionType,

      // Pool reference
      pool: UniswapV3Pool.fromJSON(json.pool),
      isToken0Quote: json.isToken0Quote,

      // PnL fields (string → bigint)
      currentValue: BigInt(json.currentValue),
      currentCostBasis: BigInt(json.currentCostBasis),
      realizedPnl: BigInt(json.realizedPnl),
      unrealizedPnl: BigInt(json.unrealizedPnl),
      realizedCashflow: BigInt(json.realizedCashflow),
      unrealizedCashflow: BigInt(json.unrealizedCashflow),

      // Fee fields
      collectedFees: BigInt(json.collectedFees),
      unClaimedFees: BigInt(json.unClaimedFees),
      lastFeesCollectedAt: new Date(json.lastFeesCollectedAt),
      totalApr: json.totalApr,

      // Price range (string → bigint)
      priceRangeLower: BigInt(json.priceRangeLower),
      priceRangeUpper: BigInt(json.priceRangeUpper),

      // Lifecycle
      positionOpenedAt: new Date(json.positionOpenedAt),
      positionClosedAt: json.positionClosedAt ? new Date(json.positionClosedAt) : null,
      isActive: json.isActive,

      // Protocol-specific
      config: UniswapV3PositionConfig.fromJSON(json.config as unknown as UniswapV3PositionConfigJSON),
      state: positionStateFromJSON(json.state as unknown as UniswapV3PositionStateJSON),

      // Timestamps
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
