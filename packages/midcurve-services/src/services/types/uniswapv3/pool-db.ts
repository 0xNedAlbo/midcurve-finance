/**
 * Uniswap V3 Pool State Database Serialization
 *
 * Handles conversion between TypeScript bigint values and database string representation.
 * PostgreSQL JSON fields store bigint as strings to avoid precision loss.
 */

import type { UniswapV3PoolState } from '@midcurve/shared';

/**
 * Uniswap V3 Pool State (Database Format)
 *
 * Represents pool state as stored in PostgreSQL JSON.
 * All bigint values are serialized as strings.
 */
export interface UniswapV3PoolStateDB {
  /**
   * Current sqrt(price) as a Q64.96 fixed-point value (as string)
   */
  sqrtPriceX96: string;

  /**
   * Current tick of the pool
   * Stored as number (no conversion needed)
   */
  currentTick: number;

  /**
   * Total liquidity currently in the pool (as string)
   */
  liquidity: string;

  /**
   * Accumulated fees per unit of liquidity for token0 (as string)
   */
  feeGrowthGlobal0: string;

  /**
   * Accumulated fees per unit of liquidity for token1 (as string)
   */
  feeGrowthGlobal1: string;
}

/**
 * Convert database state to application state
 *
 * Deserializes string values to native bigint for use in application code.
 *
 * @param stateDB - Pool state from database (with string values)
 * @returns Pool state with native bigint values
 *
 * @example
 * ```typescript
 * const dbState = {
 *   sqrtPriceX96: "1461446703485210103287273052203988822378723970341",
 *   currentTick: -197312,
 *   liquidity: "27831485581196817042",
 *   feeGrowthGlobal0: "123456789",
 *   feeGrowthGlobal1: "987654321"
 * };
 *
 * const state = toPoolState(dbState);
 * // {
 * //   sqrtPriceX96: 1461446703485210103287273052203988822378723970341n,
 * //   currentTick: -197312,
 * //   liquidity: 27831485581196817042n,
 * //   feeGrowthGlobal0: 123456789n,
 * //   feeGrowthGlobal1: 987654321n
 * // }
 * ```
 */
export function toPoolState(stateDB: UniswapV3PoolStateDB): UniswapV3PoolState {
  return {
    sqrtPriceX96: BigInt(stateDB.sqrtPriceX96),
    currentTick: stateDB.currentTick,
    liquidity: BigInt(stateDB.liquidity),
    feeGrowthGlobal0: BigInt(stateDB.feeGrowthGlobal0),
    feeGrowthGlobal1: BigInt(stateDB.feeGrowthGlobal1),
  };
}

/**
 * Convert application state to database state
 *
 * Serializes native bigint values to strings for PostgreSQL JSON storage.
 *
 * @param state - Pool state with native bigint values
 * @returns Pool state for database storage (with string values)
 *
 * @example
 * ```typescript
 * const state: UniswapV3PoolState = {
 *   sqrtPriceX96: 1461446703485210103287273052203988822378723970341n,
 *   currentTick: -197312,
 *   liquidity: 27831485581196817042n,
 *   feeGrowthGlobal0: 123456789n,
 *   feeGrowthGlobal1: 987654321n
 * };
 *
 * const dbState = toPoolStateDB(state);
 * // {
 * //   sqrtPriceX96: "1461446703485210103287273052203988822378723970341",
 * //   currentTick: -197312,
 * //   liquidity: "27831485581196817042",
 * //   feeGrowthGlobal0: "123456789",
 * //   feeGrowthGlobal1: "987654321"
 * // }
 * ```
 */
export function toPoolStateDB(state: UniswapV3PoolState): UniswapV3PoolStateDB {
  return {
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    currentTick: state.currentTick,
    liquidity: state.liquidity.toString(),
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}
