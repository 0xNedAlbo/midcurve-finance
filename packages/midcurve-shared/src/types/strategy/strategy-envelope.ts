/**
 * Strategy Envelope Types
 *
 * Wraps strategy-specific configuration with type-safe access.
 * Uses the StrategyConfigMap pattern for compile-time type safety.
 */

import type {
  BasicUniswapV3StrategyConfig,
  BasicUniswapV3StrategyState,
} from './configs/index.js';

/**
 * Known strategy type identifiers
 */
export type StrategyType = 'basicUniswapV3';

/**
 * Strategy Config and State Mapping
 *
 * Maps strategy type identifiers to their corresponding config and state types.
 * Follows the same pattern as HedgeConfigMap for consistency.
 */
export interface StrategyConfigMap {
  basicUniswapV3: {
    config: BasicUniswapV3StrategyConfig;
    state: BasicUniswapV3StrategyState;
  };
}

/**
 * Strategy Envelope
 *
 * Generic wrapper for strategy configuration.
 * When T is known at compile time, config is fully typed.
 *
 * @template T - Strategy type identifier
 */
export interface StrategyEnvelope<T extends StrategyType = StrategyType> {
  /** Strategy type identifier */
  strategyType: T;
  /** Strategy-specific configuration (type-safe when T is known) */
  config: T extends keyof StrategyConfigMap
    ? StrategyConfigMap[T]['config']
    : unknown;
}

/**
 * Type alias for any strategy envelope
 */
export type AnyStrategyEnvelope = StrategyEnvelope<StrategyType>;

// ============================================================
// Type Guards
// ============================================================

/**
 * Type guard for basicUniswapV3 strategy
 */
export function isBasicUniswapV3Strategy(
  envelope: StrategyEnvelope
): envelope is StrategyEnvelope<'basicUniswapV3'> {
  return envelope.strategyType === 'basicUniswapV3';
}
