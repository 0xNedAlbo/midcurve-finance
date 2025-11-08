/**
 * Uniswap V3 Pool Price Database Types
 *
 * Database serialization types for Uniswap V3 pool price state.
 * Converts bigint to string for JSON storage in PostgreSQL.
 */

import type {
  UniswapV3PoolPriceConfig,
  UniswapV3PoolPriceState,
} from '@midcurve/shared';

/**
 * Uniswap V3 Pool Price Config (Database)
 *
 * Config contains only primitives (number), so no serialization needed.
 * This type is identical to UniswapV3PoolPriceConfig.
 */
export type UniswapV3PoolPriceConfigDB = UniswapV3PoolPriceConfig;

/**
 * Uniswap V3 Pool Price State (Database)
 *
 * State serialization for database storage.
 * Converts bigint to string for JSON compatibility.
 */
export interface UniswapV3PoolPriceStateDB {
  /**
   * Historical sqrt(price) as a Q64.96 fixed-point value
   * Stored as string (from bigint)
   */
  sqrtPriceX96: string;

  /**
   * Historical tick of the pool
   * Stored as number (no conversion needed)
   */
  tick: number;
}

/**
 * Parse state from database format to application format
 *
 * Converts string values to bigint.
 *
 * @param stateDB - State from database (string values)
 * @returns Parsed state with bigint values
 */
export function parseUniswapV3PoolPriceState(
  stateDB: UniswapV3PoolPriceStateDB
): UniswapV3PoolPriceState {
  return {
    sqrtPriceX96: BigInt(stateDB.sqrtPriceX96),
    tick: stateDB.tick,
  };
}

/**
 * Serialize state from application format to database format
 *
 * Converts bigint values to strings.
 *
 * @param state - Application state with bigint values
 * @returns Serialized state for database storage
 */
export function serializeUniswapV3PoolPriceState(
  state: UniswapV3PoolPriceState
): UniswapV3PoolPriceStateDB {
  return {
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    tick: state.tick,
  };
}

/**
 * Parse config from database format to application format
 *
 * Config contains only primitives, so this is a pass-through.
 *
 * @param configDB - Config from database
 * @returns Parsed config (unchanged)
 */
export function parseUniswapV3PoolPriceConfig(
  configDB: UniswapV3PoolPriceConfigDB
): UniswapV3PoolPriceConfig {
  return configDB;
}

/**
 * Serialize config from application format to database format
 *
 * Config contains only primitives, so this is a pass-through.
 *
 * @param config - Application config
 * @returns Serialized config (unchanged)
 */
export function serializeUniswapV3PoolPriceConfig(
  config: UniswapV3PoolPriceConfig
): UniswapV3PoolPriceConfigDB {
  return config;
}
