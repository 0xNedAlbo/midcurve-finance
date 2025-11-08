/**
 * Uniswap V3 Pool Price Types
 *
 * Complete type definitions for Uniswap V3 historic pool price snapshots.
 * Shared across API, UI, and Workers.
 */

import type { PoolPrice } from '../pool-price.js';
import type { PoolPriceConfigMap } from '../pool-price-config.js';

export type { UniswapV3PoolPriceConfig } from './pool-price-config.js';
export type { UniswapV3PoolPriceState } from './pool-price-state.js';

/**
 * Type alias for Uniswap V3 pool price
 *
 * Equivalent to PoolPrice<'uniswapv3'>.
 */
export type UniswapV3PoolPrice = PoolPrice<'uniswapv3'>;

/**
 * Union type for any pool price
 *
 * Can be a pool price from any supported protocol.
 */
export type AnyPoolPrice = PoolPrice<keyof PoolPriceConfigMap>;
