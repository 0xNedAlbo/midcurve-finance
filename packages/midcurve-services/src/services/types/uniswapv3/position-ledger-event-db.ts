/**
 * Uniswap V3 Position Ledger Event Database Serialization
 *
 * Handles conversion between TypeScript bigint values and database string representation.
 * PostgreSQL JSON fields store bigint as strings to avoid precision loss.
 *
 * This file provides:
 * - DB-serialized versions of Config and State types
 * - Conversion functions (to/from DB format)
 */

import type { UniswapV3LedgerEventConfig } from '@midcurve/shared';
import type {
  UniswapV3LedgerEventState,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
} from '@midcurve/shared';

// ============================================================================
// CONFIG SERIALIZATION
// ============================================================================

/**
 * Uniswap V3 Position Ledger Event Config (Database Format)
 *
 * Represents event configuration as stored in PostgreSQL JSON.
 * All bigint values are serialized as strings.
 */
export interface UniswapV3LedgerEventConfigDB {
  /**
   * EVM chain ID (no conversion needed)
   */
  chainId: number;

  /**
   * NFT token ID (as string)
   */
  nftId: string;

  /**
   * Block number (as string)
   */
  blockNumber: string;

  /**
   * Transaction index (no conversion needed)
   */
  txIndex: number;

  /**
   * Log index (no conversion needed)
   */
  logIndex: number;

  /**
   * Transaction hash (no conversion needed)
   */
  txHash: string;

  /**
   * Change in liquidity (as string)
   */
  deltaL: string;

  /**
   * Liquidity after event (as string)
   */
  liquidityAfter: string;

  /**
   * Fees collected in token0 (as string)
   */
  feesCollected0: string;

  /**
   * Fees collected in token1 (as string)
   */
  feesCollected1: string;

  /**
   * Uncollected principal in token0 (as string)
   */
  uncollectedPrincipal0After: string;

  /**
   * Uncollected principal in token1 (as string)
   */
  uncollectedPrincipal1After: string;

  /**
   * Pool price (sqrtPriceX96) (as string)
   */
  sqrtPriceX96: string;
}

/**
 * Convert database config to application config
 *
 * Deserializes string values to native bigint for use in application code.
 *
 * @param configDB - Event config from database (with string values)
 * @returns Event config with native bigint values
 */
export function toEventConfig(
  configDB: UniswapV3LedgerEventConfigDB
): UniswapV3LedgerEventConfig {
  return {
    chainId: configDB.chainId,
    nftId: BigInt(configDB.nftId),
    blockNumber: BigInt(configDB.blockNumber),
    txIndex: configDB.txIndex,
    logIndex: configDB.logIndex,
    txHash: configDB.txHash,
    deltaL: BigInt(configDB.deltaL),
    liquidityAfter: BigInt(configDB.liquidityAfter),
    feesCollected0: BigInt(configDB.feesCollected0),
    feesCollected1: BigInt(configDB.feesCollected1),
    uncollectedPrincipal0After: BigInt(configDB.uncollectedPrincipal0After),
    uncollectedPrincipal1After: BigInt(configDB.uncollectedPrincipal1After),
    sqrtPriceX96: BigInt(configDB.sqrtPriceX96),
  };
}

/**
 * Convert application config to database config
 *
 * Serializes native bigint values to strings for PostgreSQL JSON storage.
 *
 * @param config - Event config with native bigint values
 * @returns Event config for database storage (with string values)
 */
export function toEventConfigDB(
  config: UniswapV3LedgerEventConfig
): UniswapV3LedgerEventConfigDB {
  return {
    chainId: config.chainId,
    nftId: config.nftId.toString(),
    blockNumber: config.blockNumber.toString(),
    txIndex: config.txIndex,
    logIndex: config.logIndex,
    txHash: config.txHash,
    deltaL: config.deltaL.toString(),
    liquidityAfter: config.liquidityAfter.toString(),
    feesCollected0: config.feesCollected0.toString(),
    feesCollected1: config.feesCollected1.toString(),
    uncollectedPrincipal0After: config.uncollectedPrincipal0After.toString(),
    uncollectedPrincipal1After: config.uncollectedPrincipal1After.toString(),
    sqrtPriceX96: config.sqrtPriceX96.toString(),
  };
}

// ============================================================================
// STATE SERIALIZATION
// ============================================================================

/**
 * Uniswap V3 IncreaseLiquidity Event (Database Format)
 * All bigint values as strings
 */
export interface UniswapV3IncreaseLiquidityEventDB {
  eventType: 'INCREASE_LIQUIDITY';
  tokenId: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/**
 * Uniswap V3 DecreaseLiquidity Event (Database Format)
 * All bigint values as strings
 */
export interface UniswapV3DecreaseLiquidityEventDB {
  eventType: 'DECREASE_LIQUIDITY';
  tokenId: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/**
 * Uniswap V3 Collect Event (Database Format)
 * All bigint values as strings
 */
export interface UniswapV3CollectEventDB {
  eventType: 'COLLECT';
  tokenId: string;
  recipient: string;
  amount0: string;
  amount1: string;
}

/**
 * Uniswap V3 Position Ledger Event State (Database Format)
 *
 * Union type representing any of the three event types.
 * All bigint values are serialized as strings.
 */
export type UniswapV3LedgerEventStateDB =
  | UniswapV3IncreaseLiquidityEventDB
  | UniswapV3DecreaseLiquidityEventDB
  | UniswapV3CollectEventDB;

/**
 * Convert database state to application state
 *
 * Deserializes string values to native bigint for use in application code.
 * Uses discriminated union to properly type the result.
 *
 * @param stateDB - Event state from database (with string values)
 * @returns Event state with native bigint values
 */
export function toEventState(
  stateDB: UniswapV3LedgerEventStateDB
): UniswapV3LedgerEventState {
  if (stateDB.eventType === 'INCREASE_LIQUIDITY') {
    const result: UniswapV3IncreaseLiquidityEvent = {
      eventType: 'INCREASE_LIQUIDITY',
      tokenId: BigInt(stateDB.tokenId),
      liquidity: BigInt(stateDB.liquidity),
      amount0: BigInt(stateDB.amount0),
      amount1: BigInt(stateDB.amount1),
    };
    return result;
  } else if (stateDB.eventType === 'DECREASE_LIQUIDITY') {
    const result: UniswapV3DecreaseLiquidityEvent = {
      eventType: 'DECREASE_LIQUIDITY',
      tokenId: BigInt(stateDB.tokenId),
      liquidity: BigInt(stateDB.liquidity),
      amount0: BigInt(stateDB.amount0),
      amount1: BigInt(stateDB.amount1),
    };
    return result;
  } else {
    const result: UniswapV3CollectEvent = {
      eventType: 'COLLECT',
      tokenId: BigInt(stateDB.tokenId),
      recipient: stateDB.recipient,
      amount0: BigInt(stateDB.amount0),
      amount1: BigInt(stateDB.amount1),
    };
    return result;
  }
}

/**
 * Convert application state to database state
 *
 * Serializes native bigint values to strings for PostgreSQL JSON storage.
 * Uses discriminated union to properly handle each event type.
 *
 * @param state - Event state with native bigint values
 * @returns Event state for database storage (with string values)
 */
export function toEventStateDB(
  state: UniswapV3LedgerEventState
): UniswapV3LedgerEventStateDB {
  if (state.eventType === 'INCREASE_LIQUIDITY') {
    const result: UniswapV3IncreaseLiquidityEventDB = {
      eventType: 'INCREASE_LIQUIDITY',
      tokenId: state.tokenId.toString(),
      liquidity: state.liquidity.toString(),
      amount0: state.amount0.toString(),
      amount1: state.amount1.toString(),
    };
    return result;
  } else if (state.eventType === 'DECREASE_LIQUIDITY') {
    const result: UniswapV3DecreaseLiquidityEventDB = {
      eventType: 'DECREASE_LIQUIDITY',
      tokenId: state.tokenId.toString(),
      liquidity: state.liquidity.toString(),
      amount0: state.amount0.toString(),
      amount1: state.amount1.toString(),
    };
    return result;
  } else {
    const result: UniswapV3CollectEventDB = {
      eventType: 'COLLECT',
      tokenId: state.tokenId.toString(),
      recipient: state.recipient,
      amount0: state.amount0.toString(),
      amount1: state.amount1.toString(),
    };
    return result;
  }
}
