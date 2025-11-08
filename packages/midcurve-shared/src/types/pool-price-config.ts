/**
 * Platform-specific pool price configurations
 *
 * Pool price config mapping pattern ensures type-safe protocol/config/state pairing.
 * Each protocol defines its own config and state types for historic price snapshots.
 */

import type { UniswapV3PoolPriceConfig } from './uniswapv3/pool-price-config.js';
import type { UniswapV3PoolPriceState } from './uniswapv3/pool-price-state.js';

// Re-export for convenience
export type { UniswapV3PoolPriceConfig } from './uniswapv3/pool-price-config.js';
export type { UniswapV3PoolPriceState } from './uniswapv3/pool-price-state.js';

/**
 * Pool Price Config/State Mapping
 *
 * Maps protocol identifiers to their corresponding config types and state types
 * for historic price snapshots. Ensures type safety: PoolPrice<'uniswapv3'> can
 * only have UniswapV3PoolPriceConfig and UniswapV3PoolPriceState.
 *
 * When adding a new protocol:
 * 1. Create the config interface (e.g., OrcaPoolPriceConfig)
 * 2. Create the state interface (e.g., OrcaPoolPriceState)
 * 3. Add entry to this mapping
 */
export interface PoolPriceConfigMap {
  uniswapv3: {
    config: UniswapV3PoolPriceConfig;
    state: UniswapV3PoolPriceState;
  };
  // Future protocols:
  // orca: {
  //   config: OrcaPoolPriceConfig;
  //   state: OrcaPoolPriceState;
  // };
  // raydium: {
  //   config: RaydiumPoolPriceConfig;
  //   state: RaydiumPoolPriceState;
  // };
  // pancakeswapv3: {
  //   config: PancakeSwapV3PoolPriceConfig;
  //   state: PancakeSwapV3PoolPriceState;
  // };
}
