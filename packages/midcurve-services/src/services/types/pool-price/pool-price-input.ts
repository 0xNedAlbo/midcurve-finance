/**
 * Pool Price Input Types
 *
 * Input types for pool price service operations.
 * These types omit database-generated fields (id, createdAt, updatedAt).
 */

import type {
  PoolPriceProtocol,
  UniswapV3PoolPriceConfig,
  UniswapV3PoolPriceState,
} from '@midcurve/shared';

// =============================================================================
// BASE INPUT INTERFACES
// =============================================================================

/**
 * Base interface for creating any pool price
 */
interface BaseCreatePoolPriceInput {
  protocol: PoolPriceProtocol;
  poolId: string;
  timestamp: Date;
  token1PricePerToken0: bigint;
  token0PricePerToken1: bigint;
}

/**
 * Base interface for updating any pool price
 */
interface BaseUpdatePoolPriceInput {
  timestamp?: Date;
  token1PricePerToken0?: bigint;
  token0PricePerToken1?: bigint;
}

// =============================================================================
// DISCOVERY INPUTS
// =============================================================================

/**
 * Uniswap V3 Pool Price Discovery Input
 *
 * Protocol-specific parameters needed to discover a historic pool price snapshot.
 * The poolId is passed separately as a common parameter.
 */
export interface UniswapV3PoolPriceDiscoverInput {
  /**
   * Block number to fetch the price at
   * Must be a valid historical block number
   */
  blockNumber: number;
}

// =============================================================================
// UNISWAP V3 INPUT TYPES
// =============================================================================

/**
 * Input for creating a Uniswap V3 pool price snapshot
 */
export interface CreateUniswapV3PoolPriceInput extends BaseCreatePoolPriceInput {
  protocol: 'uniswapv3';
  config: UniswapV3PoolPriceConfig;
  state: UniswapV3PoolPriceState;
}

/**
 * Input for updating a Uniswap V3 pool price snapshot
 */
export interface UpdateUniswapV3PoolPriceInput extends BaseUpdatePoolPriceInput {
  config?: Partial<UniswapV3PoolPriceConfig>;
  state?: Partial<UniswapV3PoolPriceState>;
}

// =============================================================================
// UNION TYPES
// =============================================================================

/**
 * Union type for any pool price create input
 */
export type CreateAnyPoolPriceInput = CreateUniswapV3PoolPriceInput;

/**
 * Union type for any pool price update input
 */
export type UpdateAnyPoolPriceInput = UpdateUniswapV3PoolPriceInput;
