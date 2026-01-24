/**
 * Uniswap V3 Pool Price
 *
 * Concrete pool price implementation for Uniswap V3 protocol.
 * Extends BasePoolPrice with Uniswap V3 specific configuration and state.
 */

import { BasePoolPrice } from '../base-pool-price.js';
import type {
  PoolPriceProtocol,
  BasePoolPriceParams,
  PoolPriceRow,
} from '../pool-price.types.js';
import {
  type UniswapV3PoolPriceConfig,
  type UniswapV3PoolPriceConfigJSON,
  configToJSON,
  configFromJSON,
} from './uniswapv3-pool-price-config.js';
import {
  type UniswapV3PoolPriceState,
  type UniswapV3PoolPriceStateJSON,
  priceStateToJSON,
  priceStateFromJSON,
} from './uniswapv3-pool-price-state.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Parameters for constructing a UniswapV3PoolPrice.
 */
export interface UniswapV3PoolPriceParams extends BasePoolPriceParams {
  config: UniswapV3PoolPriceConfig;
  state: UniswapV3PoolPriceState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for UniswapV3PoolPrice factory method.
 * Extends PoolPriceRow with protocol narrowed to 'uniswapv3'.
 */
export interface UniswapV3PoolPriceRow extends PoolPriceRow {
  protocol: 'uniswapv3';
}

// ============================================================================
// POOL PRICE CLASS
// ============================================================================

/**
 * UniswapV3PoolPrice
 *
 * Represents a Uniswap V3 pool price snapshot.
 * Provides type-safe access to Uniswap V3 specific configuration and state.
 *
 * @example
 * ```typescript
 * // From database
 * const price = UniswapV3PoolPrice.fromDB(row);
 *
 * // Access typed config
 * console.log(price.blockNumber);    // 18000000
 * console.log(price.blockTimestamp); // 1693526400
 *
 * // Access typed state
 * console.log(price.sqrtPriceX96);   // 1234567890123456789n (bigint)
 * console.log(price.tick);           // 202919
 *
 * // Access price values
 * console.log(price.token1PricePerToken0); // bigint
 *
 * // For API response
 * return createSuccessResponse(price.toJSON());
 * ```
 */
export class UniswapV3PoolPrice extends BasePoolPrice {
  readonly protocol: PoolPriceProtocol = 'uniswapv3';

  private readonly _config: UniswapV3PoolPriceConfig;
  private readonly _state: UniswapV3PoolPriceState;

  constructor(params: UniswapV3PoolPriceParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Config Accessors (PoolPriceInterface compliance)
  // ============================================================================

  /**
   * Get config as generic Record (for PoolPriceInterface compliance).
   */
  get config(): Record<string, unknown> {
    return configToJSON(this._config) as unknown as Record<string, unknown>;
  }

  /**
   * Get state as generic Record (for PoolPriceInterface compliance).
   * Converts bigint values to strings.
   */
  get state(): Record<string, unknown> {
    return priceStateToJSON(this._state) as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  /**
   * Get strongly-typed config for internal use.
   */
  get typedConfig(): UniswapV3PoolPriceConfig {
    return this._config;
  }

  /**
   * Get strongly-typed state for internal use.
   */
  get typedState(): UniswapV3PoolPriceState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors - Config
  // ============================================================================

  /** Block number when price was recorded */
  get blockNumber(): number {
    return this._config.blockNumber;
  }

  /** Unix timestamp of the block (in seconds) */
  get blockTimestamp(): number {
    return this._config.blockTimestamp;
  }

  // ============================================================================
  // Convenience Accessors - State
  // ============================================================================

  /** Current sqrt(price) as Q64.96 fixed-point value at snapshot time */
  get sqrtPriceX96(): bigint {
    return this._state.sqrtPriceX96;
  }

  /** Current tick at snapshot time */
  get tick(): number {
    return this._state.tick;
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create UniswapV3PoolPrice from database row.
   *
   * @param row - Database row from Prisma
   * @returns UniswapV3PoolPrice instance
   */
  static fromDB(row: UniswapV3PoolPriceRow): UniswapV3PoolPrice {
    const configJSON = row.config as unknown as UniswapV3PoolPriceConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3PoolPriceStateJSON;

    return new UniswapV3PoolPrice({
      id: row.id,
      poolId: row.poolId,
      timestamp: row.timestamp,
      token1PricePerToken0: row.token1PricePerToken0,
      token0PricePerToken1: row.token0PricePerToken1,
      config: configFromJSON(configJSON),
      state: priceStateFromJSON(stateJSON),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
