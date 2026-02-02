/**
 * Uniswap V3 Pool
 *
 * Concrete pool implementation for Uniswap V3 protocol.
 * Extends BasePool with Uniswap V3 specific configuration and state.
 */

import { Erc20Token, type Erc20TokenRow } from '../../token/index.js';
import { BasePool } from '../base-pool.js';
import type { Protocol, PoolType, BasePoolParams, PoolRow, PoolJSON } from '../pool.types.js';
import {
  UniswapV3PoolConfig,
  type UniswapV3PoolConfigJSON,
} from './uniswapv3-pool-config.js';
import {
  type UniswapV3PoolState,
  type UniswapV3PoolStateJSON,
  stateToJSON,
  stateFromJSON,
} from './uniswapv3-pool-state.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Parameters for constructing a UniswapV3Pool.
 */
export interface UniswapV3PoolParams extends BasePoolParams {
  config: UniswapV3PoolConfig;
  state: UniswapV3PoolState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for UniswapV3Pool factory method.
 * Extends PoolRow with protocol narrowed to 'uniswapv3'.
 */
export interface UniswapV3PoolRow extends PoolRow {
  protocol: 'uniswapv3';
}

// ============================================================================
// POOL CLASS
// ============================================================================

/**
 * UniswapV3Pool
 *
 * Represents a Uniswap V3 concentrated liquidity pool.
 * Provides type-safe access to Uniswap V3 specific configuration and state.
 *
 * @example
 * ```typescript
 * // From database with pre-fetched tokens
 * const pool = UniswapV3Pool.fromDB(row, token0, token1);
 *
 * // Access typed config
 * console.log(pool.chainId);      // 1
 * console.log(pool.address);      // '0x8ad599c3...'
 * console.log(pool.tickSpacing);  // 60
 *
 * // Access typed state
 * console.log(pool.sqrtPriceX96); // 1234567890123456789n (bigint)
 * console.log(pool.currentTick);  // 202919
 *
 * // For API response
 * return createSuccessResponse(pool.toJSON());
 * ```
 */
export class UniswapV3Pool extends BasePool {
  readonly protocol: Protocol = 'uniswapv3';

  private readonly _config: UniswapV3PoolConfig;
  private readonly _state: UniswapV3PoolState;

  constructor(params: UniswapV3PoolParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Config Accessors (PoolInterface compliance)
  // ============================================================================

  /**
   * Get config as generic Record (for PoolInterface compliance).
   */
  get config(): Record<string, unknown> {
    return this._config.toJSON() as unknown as Record<string, unknown>;
  }

  /**
   * Get state as generic Record (for PoolInterface compliance).
   * Converts bigint values to strings.
   */
  get state(): Record<string, unknown> {
    return stateToJSON(this._state) as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  /**
   * Get strongly-typed config for internal use.
   */
  get typedConfig(): UniswapV3PoolConfig {
    return this._config;
  }

  /**
   * Get strongly-typed state for internal use.
   */
  get typedState(): UniswapV3PoolState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors - Config
  // ============================================================================

  /** Chain ID where the pool is deployed */
  get chainId(): number {
    return this._config.chainId;
  }

  /** Pool contract address (EIP-55 checksummed) */
  get address(): string {
    return this._config.address;
  }

  /** Tick spacing for this fee tier */
  get tickSpacing(): number {
    return this._config.tickSpacing;
  }

  // ============================================================================
  // Convenience Accessors - State
  // ============================================================================

  /** Current sqrt(price) as Q64.96 fixed-point value */
  get sqrtPriceX96(): bigint {
    return this._state.sqrtPriceX96;
  }

  /** Current tick of the pool */
  get currentTick(): number {
    return this._state.currentTick;
  }

  /** Total liquidity currently in the pool */
  get liquidity(): bigint {
    return this._state.liquidity;
  }

  /** Accumulated fees per unit of liquidity for token0 */
  get feeGrowthGlobal0(): bigint {
    return this._state.feeGrowthGlobal0;
  }

  /** Accumulated fees per unit of liquidity for token1 */
  get feeGrowthGlobal1(): bigint {
    return this._state.feeGrowthGlobal1;
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create UniswapV3Pool from database row with pre-fetched tokens.
   *
   * Tokens must be fetched separately and passed in because:
   * - Pools store token IDs, not full token data
   * - Token data may be cached or fetched from different sources
   * - Allows for token reuse across multiple pools
   *
   * @param row - Database row from Prisma
   * @param token0 - Pre-fetched token0 instance
   * @param token1 - Pre-fetched token1 instance
   * @returns UniswapV3Pool instance
   */
  static fromDB(
    row: UniswapV3PoolRow,
    token0: Erc20Token,
    token1: Erc20Token
  ): UniswapV3Pool {
    const configJSON = row.config as unknown as UniswapV3PoolConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3PoolStateJSON;

    return new UniswapV3Pool({
      id: row.id,
      poolType: row.poolType as PoolType,
      token0,
      token1,
      feeBps: row.feeBps,
      config: UniswapV3PoolConfig.fromJSON(configJSON),
      state: stateFromJSON(stateJSON),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /**
   * Create UniswapV3Pool from database row with included token relations.
   *
   * Convenience method when tokens are included via Prisma relations.
   * Automatically converts token rows to Erc20Token instances.
   *
   * @param row - Database row with token0 and token1 included
   * @returns UniswapV3Pool instance
   * @throws Error if token0 or token1 relations are not included
   */
  static fromDBWithTokens(row: UniswapV3PoolRow): UniswapV3Pool {
    if (!row.token0 || !row.token1) {
      throw new Error(
        'UniswapV3Pool.fromDBWithTokens requires token0 and token1 to be included'
      );
    }

    const token0 = Erc20Token.fromDB(row.token0 as Erc20TokenRow);
    const token1 = Erc20Token.fromDB(row.token1 as Erc20TokenRow);

    return UniswapV3Pool.fromDB(row, token0, token1);
  }

  /**
   * Create UniswapV3Pool from JSON (API response).
   *
   * Deserializes a PoolJSON object back into a UniswapV3Pool instance.
   * Recursively reconstructs nested token instances.
   *
   * @param json - JSON data from API response
   * @returns UniswapV3Pool instance
   * @throws Error if protocol is not 'uniswapv3'
   *
   * @example
   * ```typescript
   * const response = await fetch('/api/v1/pools/uniswapv3/...');
   * const json = await response.json();
   * const pool = UniswapV3Pool.fromJSON(json.data);
   * console.log(pool.sqrtPriceX96); // bigint value
   * ```
   */
  static fromJSON(json: PoolJSON): UniswapV3Pool {
    if (json.protocol !== 'uniswapv3') {
      throw new Error(`Expected protocol 'uniswapv3', got '${json.protocol}'`);
    }

    return new UniswapV3Pool({
      id: json.id,
      poolType: json.poolType,
      token0: Erc20Token.fromJSON(json.token0),
      token1: Erc20Token.fromJSON(json.token1),
      feeBps: json.feeBps,
      config: UniswapV3PoolConfig.fromJSON(json.config as unknown as UniswapV3PoolConfigJSON),
      state: stateFromJSON(json.state as unknown as UniswapV3PoolStateJSON),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
