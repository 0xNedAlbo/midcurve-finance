/**
 * Platform-specific pool configurations
 *
 * Pool config mapping pattern ensures type-safe protocol/config/state/token pairing.
 */

import type { UniswapV3PoolConfig } from './uniswapv3/pool-config.js';
import type { UniswapV3PoolState } from './uniswapv3/pool-state.js';
import type { HodlPoolConfig } from './hodl/pool-config.js';
import type { HodlPoolState } from './hodl/pool-state.js';
import type { TokenConfigMap } from './token-config.js';

// Re-export for convenience
export type { UniswapV3PoolConfig } from './uniswapv3/pool-config.js';
export type { UniswapV3PoolState } from './uniswapv3/pool-state.js';
export type { HodlPoolConfig } from './hodl/pool-config.js';
export type { HodlPoolState } from './hodl/pool-state.js';

/**
 * Pool Config/State/Token Mapping
 *
 * Maps protocol identifiers to their corresponding config types, state types,
 * and token types. Ensures type safety: Pool<'uniswapv3'> can only have
 * UniswapV3PoolConfig, UniswapV3PoolState, and Token<'erc20'> for both tokens.
 *
 * When adding a new protocol:
 * 1. Create the config interface (e.g., OrcaPoolConfig)
 * 2. Create the state interface (e.g., OrcaPoolState)
 * 3. Determine token types (e.g., 'solana-spl')
 * 4. Add entry to this mapping
 */
export interface PoolConfigMap {
  uniswapv3: {
    config: UniswapV3PoolConfig;
    state: UniswapV3PoolState;
    token0Type: 'erc20';
    token1Type: 'erc20';
  };
  /**
   * HODL virtual pool
   *
   * Used for HODL positions to reference the quote token.
   * token0 and token1 both reference the same quote token (price = 1).
   * Supports any token type (ERC-20, basic currency, or future types).
   */
  hodl: {
    config: HodlPoolConfig;
    state: HodlPoolState;
    token0Type: keyof TokenConfigMap;
    token1Type: keyof TokenConfigMap;
  };
  // Future protocols:
  // orca: {
  //   config: OrcaPoolConfig;
  //   state: OrcaPoolState;
  //   token0Type: 'solana-spl';
  //   token1Type: 'solana-spl';
  // };
  // raydium: {
  //   config: RaydiumPoolConfig;
  //   state: RaydiumPoolState;
  //   token0Type: 'solana-spl';
  //   token1Type: 'solana-spl';
  // };
  // pancakeswapv3: {
  //   config: PancakeSwapV3PoolConfig;
  //   state: PancakeSwapV3PoolState;
  //   token0Type: 'erc20';
  //   token1Type: 'erc20';
  // };
}
