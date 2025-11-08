/**
 * Pool Price Input Types
 *
 * Input types for pool price service operations.
 * These types omit database-generated fields (id, createdAt, updatedAt).
 */

import type { PoolPrice, PoolPriceConfigMap } from '@midcurve/shared';

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

/**
 * Pool Price Discovery Input Map
 *
 * Maps protocol identifiers to their corresponding discovery input types.
 * Ensures type safety: discover() for protocol 'uniswapv3' requires UniswapV3PoolPriceDiscoverInput.
 *
 * Note: poolId is passed as a separate parameter (common to all protocols).
 *
 * When adding a new protocol:
 * 1. Create the discovery input interface (e.g., OrcaPoolPriceDiscoverInput)
 * 2. Add entry to this mapping
 */
export interface PoolPriceDiscoverInputMap {
  uniswapv3: UniswapV3PoolPriceDiscoverInput;
  // Future protocols:
  // orca: OrcaPoolPriceDiscoverInput;
  // raydium: RaydiumPoolPriceDiscoverInput;
  // pancakeswapv3: PancakeSwapV3PoolPriceDiscoverInput;
}

/**
 * Generic pool price discovery input type
 * Type-safe based on protocol parameter
 */
export type PoolPriceDiscoverInput<P extends keyof PoolPriceDiscoverInputMap> =
  PoolPriceDiscoverInputMap[P];

/**
 * Union type for any pool price discovery input
 */
export type AnyPoolPriceDiscoverInput =
  PoolPriceDiscoverInput<keyof PoolPriceDiscoverInputMap>;

/**
 * Input for creating a new pool price snapshot
 *
 * Omits database-generated fields (id, createdAt, updatedAt).
 * All other fields are required.
 *
 * @template P - Protocol key from PoolPriceConfigMap ('uniswapv3', etc.)
 */
export type CreatePoolPriceInput<P extends keyof PoolPriceConfigMap> = Omit<
  PoolPrice<P>,
  'id' | 'createdAt' | 'updatedAt'
>;

/**
 * Input for updating an existing pool price snapshot
 *
 * All fields are optional except for the ones that are immutable.
 * In practice, pool prices are immutable historical records, so updates are rare.
 *
 * Note: Pool prices are typically write-once records. Updates might only be used
 * for corrections or re-calculations.
 *
 * @template P - Protocol key from PoolPriceConfigMap ('uniswapv3', etc.)
 */
export type UpdatePoolPriceInput<P extends keyof PoolPriceConfigMap> = Partial<
  Omit<PoolPrice<P>, 'id' | 'protocol' | 'createdAt' | 'updatedAt'>
>;

/**
 * Uniswap V3 specific input types
 */
export type CreateUniswapV3PoolPriceInput = CreatePoolPriceInput<'uniswapv3'>;
export type UpdateUniswapV3PoolPriceInput = UpdatePoolPriceInput<'uniswapv3'>;

/**
 * Union type for any pool price create input
 */
export type CreateAnyPoolPriceInput = CreatePoolPriceInput<keyof PoolPriceConfigMap>;

/**
 * Union type for any pool price update input
 */
export type UpdateAnyPoolPriceInput = UpdatePoolPriceInput<keyof PoolPriceConfigMap>;
