/**
 * Position Configuration Types
 *
 * Protocol-specific configuration types for Position.config field.
 * These are stored as JSON in the database.
 *
 * This file uses a mapped types pattern to enforce correct config/state pairing.
 * Each protocol is mapped to its specific config and state types.
 */

import type { UniswapV3PositionConfig } from './uniswapv3/position-config.js';
import type { UniswapV3PositionState } from './uniswapv3/position-state.js';
import type { UniswapV3Pool } from './uniswapv3/pool.js';

// Re-export for convenience
export type { UniswapV3PositionConfig } from './uniswapv3/position-config.js';

/**
 * Position Config/State/Pool Mapping
 *
 * Maps protocol identifiers to their corresponding config, state, and pool types.
 * This ensures type safety: Position<'uniswapv3'> can only have
 * UniswapV3PositionConfig, UniswapV3PositionState, and UniswapV3Pool.
 *
 * When adding a new protocol:
 * 1. Create the config interface (e.g., OrcaPositionConfig)
 * 2. Create the state interface (e.g., OrcaPositionState)
 * 3. Add entry to this mapping: orca: { config: OrcaPositionConfig; state: OrcaPositionState; pool: OrcaPool }
 */
export interface PositionConfigMap {
  uniswapv3: {
    config: UniswapV3PositionConfig;
    state: UniswapV3PositionState;
    pool: UniswapV3Pool;
  };
  // Future protocols:
  // orca: { config: OrcaPositionConfig; state: OrcaPositionState; pool: OrcaPool };
  // raydium: { config: RaydiumPositionConfig; state: RaydiumPositionState; pool: RaydiumPool };
  // pancakeswapv3: { config: PancakeSwapV3PositionConfig; state: PancakeSwapV3PositionState; pool: PancakeSwapV3Pool };
}

/**
 * Type alias for Uniswap V3 position
 * Re-exported from position.ts for convenience
 */
export type { UniswapV3Position, AnyPosition } from './position.js';
