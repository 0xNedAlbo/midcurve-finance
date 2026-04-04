/**
 * Uniswap V3 Position
 *
 * Concrete position implementation for Uniswap V3 protocol.
 * Extends BasePosition with Uniswap V3 specific configuration and state.
 */

import { TickMath } from '@uniswap/v3-sdk';
import { BasePosition } from '../base-position.js';
import { UniswapV3Pool } from '../../pool/index.js';
import { UniswapV3PoolConfig } from '../../pool/uniswapv3/uniswapv3-pool-config.js';
import type { PoolInterface } from '../../pool/index.js';
import type { Erc20Token, TokenInterface } from '../../token/index.js';
import type {
  PositionProtocol,
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
import { priceToSqrtRatioX96, tickToPrice } from '../../../utils/uniswapv3/price.js';
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
  // Computed Pool (virtual object from position data)
  // ============================================================================

  get pool(): PoolInterface {
    return new UniswapV3Pool({
      id: `uniswapv3/${this._config.chainId}/${this._config.poolAddress}`,
      token0: this.token0,
      token1: this.token1,
      config: new UniswapV3PoolConfig({
        chainId: this._config.chainId,
        address: this._config.poolAddress,
        token0: this._config.token0Address,
        token1: this._config.token1Address,
        feeBps: this._config.feeBps,
        tickSpacing: this._config.tickSpacing,
      }),
      state: {
        sqrtPriceX96: this._state.sqrtPriceX96,
        currentTick: this._state.currentTick,
        liquidity: this._state.poolLiquidity,
        feeGrowthGlobal0: this._state.feeGrowthGlobal0,
        feeGrowthGlobal1: this._state.feeGrowthGlobal1,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
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
    const baseToken = this.getBaseToken() as Erc20Token;
    const quoteToken = this.getQuoteToken() as Erc20Token;
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
    const pnlValue = positionValue - this.costBasis;
    const pnlPercent = this.costBasis > 0n
      ? Number((pnlValue * 1000000n) / this.costBasis) / 10000
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
   * @param token0 - Pre-resolved token0 instance
   * @param token1 - Pre-resolved token1 instance
   * @returns UniswapV3Position instance
   */
  static fromDB(
    row: UniswapV3PositionRow,
    token0: TokenInterface,
    token1: TokenInterface
  ): UniswapV3Position {
    const configJSON = row.config as unknown as UniswapV3PositionConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3PositionStateJSON;

    return new UniswapV3Position({
      // Identity
      id: row.id,
      positionHash: row.positionHash,
      userId: row.userId,
      type: row.type,

      // Token references
      token0,
      token1,
      isToken0Quote: row.isToken0Quote,

      // PnL fields
      currentValue: row.currentValue,
      costBasis: row.costBasis,
      realizedPnl: row.realizedPnl,
      unrealizedPnl: row.unrealizedPnl,
      realizedCashflow: row.realizedCashflow,
      unrealizedCashflow: row.unrealizedCashflow,

      // Yield fields
      collectedYield: row.collectedYield,
      unclaimedYield: row.unclaimedYield,
      lastYieldClaimedAt: row.lastYieldClaimedAt,

      // APR fields
      baseApr: row.baseApr,
      rewardApr: row.rewardApr,
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

    // Compute actual price range from ticks (needed by CloseOrderSimulationOverlay.maxRunup/maxDrawdown)
    const baseToken = (params.isToken0Quote ? params.pool.token1 : params.pool.token0) as Erc20Token;
    const quoteToken = (params.isToken0Quote ? params.pool.token0 : params.pool.token1) as Erc20Token;
    const priceRangeLower = tickToPrice(params.tickLower, baseToken.address, quoteToken.address, baseToken.decimals);
    const priceRangeUpper = tickToPrice(params.tickUpper, baseToken.address, quoteToken.address, baseToken.decimals);

    return new UniswapV3Position({
      // Identity (placeholder values for simulation)
      id: 'simulation',
      positionHash: 'simulation',
      userId: 'simulation',
      type: 'LP_CONCENTRATED',

      // Token references
      token0: params.pool.token0,
      token1: params.pool.token1,
      isToken0Quote: params.isToken0Quote,

      // PnL fields (costBasis is the key input)
      currentValue: params.costBasis, // At creation, value equals cost
      costBasis: params.costBasis,
      realizedPnl: 0n,
      unrealizedPnl: 0n,
      realizedCashflow: 0n,
      unrealizedCashflow: 0n,

      // Yield fields (not used in simulation)
      collectedYield: 0n,
      unclaimedYield: 0n,
      lastYieldClaimedAt: now,

      // APR fields (not used in simulation)
      baseApr: null,
      rewardApr: null,
      totalApr: null,

      // Price range (computed from ticks)
      priceRangeLower,
      priceRangeUpper,

      // Lifecycle
      positionOpenedAt: now,
      positionClosedAt: null,
      isActive: true,

      // Protocol-specific
      config: new UniswapV3PositionConfig({
        chainId: params.pool.chainId,
        nftId: 0, // Placeholder for simulation
        poolAddress: params.pool.address,
        token0Address: params.pool.typedConfig.token0,
        token1Address: params.pool.typedConfig.token1,
        feeBps: params.pool.feeBps,
        tickSpacing: params.pool.tickSpacing,
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
        sqrtPriceX96: params.pool.sqrtPriceX96,
        currentTick: params.pool.currentTick,
        poolLiquidity: params.pool.liquidity,
        feeGrowthGlobal0: params.pool.feeGrowthGlobal0,
        feeGrowthGlobal1: params.pool.feeGrowthGlobal1,
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

    // Reconstruct tokens from pool JSON (backward compat for API responses)
    const pool = UniswapV3Pool.fromJSON(json.pool);

    return new UniswapV3Position({
      // Identity
      id: json.id,
      positionHash: json.positionHash,
      userId: json.userId,
      type: json.type,

      // Token references (extracted from pool JSON)
      token0: pool.token0,
      token1: pool.token1,
      isToken0Quote: json.isToken0Quote,

      // PnL fields (string → bigint)
      currentValue: BigInt(json.currentValue),
      costBasis: BigInt(json.costBasis),
      realizedPnl: BigInt(json.realizedPnl),
      unrealizedPnl: BigInt(json.unrealizedPnl),
      realizedCashflow: BigInt(json.realizedCashflow),
      unrealizedCashflow: BigInt(json.unrealizedCashflow),

      // Yield fields
      collectedYield: BigInt(json.collectedYield),
      unclaimedYield: BigInt(json.unclaimedYield),
      lastYieldClaimedAt: new Date(json.lastYieldClaimedAt),

      // APR fields
      baseApr: json.baseApr,
      rewardApr: json.rewardApr,
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
