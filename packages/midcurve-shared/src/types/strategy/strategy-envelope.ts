/**
 * Strategy Envelope Types
 *
 * Wraps strategy-specific configuration with type-safe access.
 * Uses the StrategyConfigMap pattern for compile-time type safety.
 */

import type { BasicUniswapV3StrategyConfig } from './configs/index.js';

/**
 * Known strategy type identifiers
 */
export type StrategyType = 'basicUniswapV3';

/**
 * Strategy Config Mapping
 *
 * Maps strategy type identifiers to their corresponding config types.
 * Ensures type safety: StrategyEnvelope<'basicUniswapV3'> can only have BasicUniswapV3StrategyConfig.
 */
export interface StrategyConfigMap {
  basicUniswapV3: BasicUniswapV3StrategyConfig;
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
  config: T extends keyof StrategyConfigMap ? StrategyConfigMap[T] : unknown;
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
