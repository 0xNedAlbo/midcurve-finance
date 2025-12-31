/**
 * Service layer pool input types
 * Database-specific types for pool discovery and update operations
 */

import type { Pool, PoolConfigMap } from '@midcurve/shared';

/**
 * Uniswap V3 Pool Discovery Input
 *
 * Parameters needed to discover a Uniswap V3 pool from on-chain data.
 */
export interface UniswapV3PoolDiscoverInput {
  /**
   * Pool contract address
   * Will be validated and normalized to EIP-55 checksum format
   */
  poolAddress: string;

  /**
   * Chain ID where the pool is deployed
   * Examples: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;
}

/**
 * Pool Discovery Input Map
 *
 * Maps protocol identifiers to their corresponding discovery input types.
 * Ensures type safety: discover() for protocol 'uniswapv3' requires UniswapV3PoolDiscoverInput.
 *
 * When adding a new protocol:
 * 1. Create the discovery input interface (e.g., OrcaPoolDiscoverInput)
 * 2. Add entry to this mapping
 */
export interface PoolDiscoverInputMap {
  uniswapv3: UniswapV3PoolDiscoverInput;

  /**
   * Treasury pool discover input (placeholder)
   *
   * Treasury pools are virtual and don't require on-chain discovery.
   * They are created inline when a Treasury position is created.
   * This placeholder ensures type compatibility with PoolConfigMap.
   */
  treasury: never; // Treasury pools don't use pool discovery

  // Future protocols:
  // orca: OrcaPoolDiscoverInput;
  // raydium: RaydiumPoolDiscoverInput;
  // pancakeswapv3: PancakeSwapV3PoolDiscoverInput;
}

/**
 * Generic pool discovery input type
 * Type-safe based on protocol parameter
 */
export type PoolDiscoverInput<P extends keyof PoolDiscoverInputMap> =
  PoolDiscoverInputMap[P];

/**
 * Union type for any pool discovery input
 */
export type AnyPoolDiscoverInput = PoolDiscoverInput<keyof PoolDiscoverInputMap>;

/**
 * Input type for creating a new pool
 *
 * Omits database-generated fields (id, createdAt, updatedAt) and full Token objects.
 * Instead of full Token objects, requires token0Id and token1Id for database foreign keys.
 *
 * Note: This is a manual creation helper. For creating pools from on-chain data,
 * use discover() which handles token discovery and pool state fetching.
 *
 * @template P - Protocol key from PoolConfigMap ('uniswapv3', etc.)
 */
export type CreatePoolInput<P extends keyof PoolConfigMap> = Omit<
  Pool<P>,
  'id' | 'createdAt' | 'updatedAt' | 'token0' | 'token1'
> & {
  /**
   * Database ID of token0
   * Token must already exist in database
   */
  token0Id: string;

  /**
   * Database ID of token1
   * Token must already exist in database
   */
  token1Id: string;
};

/**
 * Input type aliases for creating pools
 */
export type CreateUniswapV3PoolInput = CreatePoolInput<'uniswapv3'>;
export type CreateAnyPoolInput = CreatePoolInput<keyof PoolConfigMap>;

/**
 * Input type for updating an existing pool
 *
 * Partial updates, cannot change id, protocol, poolType, tokens, or timestamps.
 *
 * Note: This is a basic helper for rare manual updates.
 * - Config updates are rare (pool parameters are immutable on-chain)
 * - State updates should typically use refresh() method
 * - Tokens (token0, token1) are immutable - set at discovery
 *
 * @template P - Protocol key from PoolConfigMap ('uniswapv3', etc.)
 */
export type UpdatePoolInput<P extends keyof PoolConfigMap> = Partial<
  Omit<
    Pool<P>,
    'id' | 'protocol' | 'poolType' | 'createdAt' | 'updatedAt' | 'token0' | 'token1'
  >
>;

/**
 * Input type aliases for updating pools
 */
export type UpdateUniswapV3PoolInput = UpdatePoolInput<'uniswapv3'>;
export type UpdateAnyPoolInput = UpdatePoolInput<keyof PoolConfigMap>;
