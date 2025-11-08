/**
 * Uniswap V3 Pool Types
 *
 * Complete type definitions for Uniswap V3 pools.
 * Shared across API, UI, and Workers.
 */

import type { Pool } from '../pool.js';
import type { PoolConfigMap } from '../pool-config.js';

export type { UniswapV3PoolConfig } from './pool-config.js';
export type { UniswapV3PoolState } from './pool-state.js';

/**
 * Type alias for Uniswap V3 pool
 *
 * Equivalent to Pool<'uniswapv3'>.
 */
export type UniswapV3Pool = Pool<'uniswapv3'>;

/**
 * Union type for any pool
 *
 * Can be a pool from any supported protocol.
 */
export type AnyPool = Pool<keyof PoolConfigMap>;
