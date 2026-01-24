/**
 * Service layer pool input types
 * Database-specific types for pool discovery and update operations
 *
 * Note: Uses data interfaces (UniswapV3PoolConfigData) not classes for inputs.
 * Services create class instances internally for serialization.
 */

import type {
  Protocol,
  PoolType,
  UniswapV3PoolConfigData,
  UniswapV3PoolState,
} from '@midcurve/shared';

// =============================================================================
// BASE INPUT INTERFACES
// =============================================================================

/**
 * Base input interface for creating any pool
 * Subtype inputs extend this with their specific config and state types
 */
interface BaseCreatePoolInput {
  /** Protocol discriminator */
  protocol: Protocol;
  /** Pool type discriminator */
  poolType: PoolType;
  /** Fee in basis points */
  feeBps: number;
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
}

/**
 * Base input interface for updating any pool
 * All fields are optional except those that identify the pool
 */
interface BaseUpdatePoolInput {
  /** Fee in basis points */
  feeBps?: number;
}

// =============================================================================
// UNISWAP V3 POOL INPUT TYPES
// =============================================================================

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
 * Input for creating a new Uniswap V3 pool
 */
export interface CreateUniswapV3PoolInput extends BaseCreatePoolInput {
  protocol: 'uniswapv3';
  poolType: 'CL_TICKS';
  config: UniswapV3PoolConfigData;
  state: UniswapV3PoolState;
}

/**
 * Input for updating an existing Uniswap V3 pool
 */
export interface UpdateUniswapV3PoolInput extends BaseUpdatePoolInput {
  config?: Partial<UniswapV3PoolConfigData>;
  state?: Partial<UniswapV3PoolState>;
}

// =============================================================================
// POOL DISCOVERY INPUT MAP
// =============================================================================

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

// =============================================================================
// UNION TYPES
// =============================================================================

/**
 * Union type for any pool create input
 */
export type CreateAnyPoolInput = CreateUniswapV3PoolInput;

/**
 * Union type for any pool update input
 */
export type UpdateAnyPoolInput = UpdateUniswapV3PoolInput;
