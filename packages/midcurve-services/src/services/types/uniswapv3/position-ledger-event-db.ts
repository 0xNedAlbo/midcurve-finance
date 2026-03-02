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

import type {
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventState,
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
   * Block hash (no conversion needed)
   */
  blockHash: string;

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
    blockHash: configDB.blockHash,
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
    blockHash: config.blockHash,
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
 * Uniswap V3 Mint Event (Database Format)
 * All bigint values as strings
 */
export interface UniswapV3MintEventDB {
  eventType: 'MINT';
  tokenId: string;
  to: string;
}

/**
 * Uniswap V3 Burn Event (Database Format)
 * All bigint values as strings
 */
export interface UniswapV3BurnEventDB {
  eventType: 'BURN';
  tokenId: string;
  from: string;
}

/**
 * Uniswap V3 Transfer Event (Database Format)
 * All bigint values as strings
 */
export interface UniswapV3TransferEventDB {
  eventType: 'TRANSFER';
  tokenId: string;
  from: string;
  to: string;
}

/**
 * Uniswap V3 Position Ledger Event State (Database Format)
 *
 * Union type representing any of the event types.
 * All bigint values are serialized as strings.
 */
export type UniswapV3LedgerEventStateDB =
  | UniswapV3IncreaseLiquidityEventDB
  | UniswapV3DecreaseLiquidityEventDB
  | UniswapV3CollectEventDB
  | UniswapV3MintEventDB
  | UniswapV3BurnEventDB
  | UniswapV3TransferEventDB;

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
  switch (stateDB.eventType) {
    case 'INCREASE_LIQUIDITY':
      return {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: BigInt(stateDB.tokenId),
        liquidity: BigInt(stateDB.liquidity),
        amount0: BigInt(stateDB.amount0),
        amount1: BigInt(stateDB.amount1),
      };
    case 'DECREASE_LIQUIDITY':
      return {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: BigInt(stateDB.tokenId),
        liquidity: BigInt(stateDB.liquidity),
        amount0: BigInt(stateDB.amount0),
        amount1: BigInt(stateDB.amount1),
      };
    case 'COLLECT':
      return {
        eventType: 'COLLECT',
        tokenId: BigInt(stateDB.tokenId),
        recipient: stateDB.recipient,
        amount0: BigInt(stateDB.amount0),
        amount1: BigInt(stateDB.amount1),
      };
    case 'MINT':
      return {
        eventType: 'MINT',
        tokenId: BigInt(stateDB.tokenId),
        to: stateDB.to,
      };
    case 'BURN':
      return {
        eventType: 'BURN',
        tokenId: BigInt(stateDB.tokenId),
        from: stateDB.from,
      };
    case 'TRANSFER':
      return {
        eventType: 'TRANSFER',
        tokenId: BigInt(stateDB.tokenId),
        from: stateDB.from,
        to: stateDB.to,
      };
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
  switch (state.eventType) {
    case 'INCREASE_LIQUIDITY':
      return {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: state.tokenId.toString(),
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'DECREASE_LIQUIDITY':
      return {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: state.tokenId.toString(),
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'COLLECT':
      return {
        eventType: 'COLLECT',
        tokenId: state.tokenId.toString(),
        recipient: state.recipient,
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'MINT':
      return {
        eventType: 'MINT',
        tokenId: state.tokenId.toString(),
        to: state.to,
      };
    case 'BURN':
      return {
        eventType: 'BURN',
        tokenId: state.tokenId.toString(),
        from: state.from,
      };
    case 'TRANSFER':
      return {
        eventType: 'TRANSFER',
        tokenId: state.tokenId.toString(),
        from: state.from,
        to: state.to,
      };
  }
}
