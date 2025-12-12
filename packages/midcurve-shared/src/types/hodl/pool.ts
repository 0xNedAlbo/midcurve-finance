/**
 * HODL Pool Types
 *
 * Type definitions for HODL virtual pools.
 * HODL pools are "virtual" pools used to reference a quote token for position valuation.
 *
 * Key characteristics:
 * - token0 and token1 both reference the same quote token
 * - poolPrice is always 1 (quote token per quote token)
 * - feeBps is always 0 (no trading fees)
 * - Used solely for Position interface compatibility
 */

import type { Pool } from '../pool.js';
import type { PoolConfigMap } from '../pool-config.js';

export type { HodlPoolConfig } from './pool-config.js';
export type { HodlPoolState } from './pool-state.js';

/**
 * Type alias for HODL pool
 *
 * Equivalent to Pool<'hodl'>.
 * Uses the generic Pool interface with HODL-specific config and state.
 */
export type HodlPool = Pool<'hodl'>;

/**
 * Type guard for HODL pools
 *
 * Safely narrows AnyPool to HodlPool, allowing access to
 * HODL-specific config and state fields.
 *
 * @param pool - Pool to check
 * @returns True if pool is a HODL pool
 *
 * @example
 * ```typescript
 * const pool: AnyPool = await getPool();
 *
 * if (isHodlPool(pool)) {
 *   // TypeScript knows pool is HodlPool here
 *   console.log(pool.state.poolPrice); // Always 1
 * }
 * ```
 */
export function isHodlPool(pool: Pool<keyof PoolConfigMap>): pool is HodlPool {
  return pool.protocol === 'hodl';
}

/**
 * Assertion function for HODL pools
 *
 * Throws an error if pool is not a HODL pool.
 * After calling this function, TypeScript knows the pool is HodlPool.
 *
 * @param pool - Pool to check
 * @throws Error if pool is not a HODL pool
 *
 * @example
 * ```typescript
 * const pool: AnyPool = await getPool();
 *
 * assertHodlPool(pool);
 * // TypeScript knows pool is HodlPool after this line
 * console.log(pool.state.poolPrice);
 * ```
 */
export function assertHodlPool(
  pool: Pool<keyof PoolConfigMap>
): asserts pool is HodlPool {
  if (!isHodlPool(pool)) {
    throw new Error(
      `Expected HODL pool, got protocol: ${(pool as Pool<keyof PoolConfigMap>).protocol}`
    );
  }
}
