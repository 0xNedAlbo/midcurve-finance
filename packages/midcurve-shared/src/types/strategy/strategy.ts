/**
 * Generic Strategy Interface
 *
 * Type-safe strategy representation using mapped types pattern.
 * Follows the same architecture as Hedge<H> and Position<P>.
 */

import type { StrategyConfigMap, StrategyType } from './strategy-envelope.js';
import type { StrategyStatus } from './strategy-status.js';

/**
 * Generic Strategy interface
 *
 * Uses mapped types to ensure type-safe access to strategy-specific
 * config and state based on the strategy type.
 *
 * @template S - The strategy type (e.g., 'basicUniswapV3')
 */
export interface Strategy<S extends StrategyType> {
  /** Unique identifier */
  id: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Owner user ID */
  userId: string;

  /** Strategy type identifier */
  strategyType: S;

  /** Human-readable name for the strategy */
  name: string;

  /** Optional description */
  description: string | null;

  // Wallet Integration

  /** Automation wallet ID (KMS-managed) */
  automationWalletId: string;

  // Intent (EIP-712 signed authorization)

  /** EIP-712 signature of the strategy intent */
  intentSignature: string;

  /** Serialized intent payload (JSON) */
  intentPayload: string;

  // Lifecycle

  /** Current strategy status */
  status: StrategyStatus;

  /** When the strategy was activated */
  activatedAt: Date | null;

  /** When the strategy was stopped/completed */
  stoppedAt: Date | null;

  /** Last execution timestamp */
  lastRunAt: Date | null;

  /** Last error message (if any) */
  lastError: string | null;

  // Protocol-specific data (type-safe via mapped types)

  /** Immutable configuration */
  config: StrategyConfigMap[S]['config'];

  /** Mutable state */
  state: StrategyConfigMap[S]['state'];
}

// =============================================================================
// Type Aliases
// =============================================================================

/**
 * BasicUniswapV3 Strategy
 */
export type BasicUniswapV3Strategy = Strategy<'basicUniswapV3'>;

/**
 * Union of all strategy types
 */
export type AnyStrategy = Strategy<StrategyType>;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for BasicUniswapV3 Strategy
 */
export function isBasicUniswapV3StrategyType(
  strategy: AnyStrategy
): strategy is BasicUniswapV3Strategy {
  return strategy.strategyType === 'basicUniswapV3';
}

/**
 * Assert that a strategy is of a specific type
 *
 * @throws Error if the strategy type doesn't match
 */
export function assertBasicUniswapV3Strategy(
  strategy: AnyStrategy
): asserts strategy is BasicUniswapV3Strategy {
  if (!isBasicUniswapV3StrategyType(strategy)) {
    throw new Error(
      `Expected basicUniswapV3 strategy, got ${(strategy as AnyStrategy).strategyType}`
    );
  }
}

/**
 * Narrow a strategy to a specific type
 *
 * @throws Error if the strategy type doesn't match
 */
export function narrowStrategyType<S extends StrategyType>(
  strategy: AnyStrategy,
  strategyType: S
): Strategy<S> {
  if (strategy.strategyType !== strategyType) {
    throw new Error(
      `Expected ${strategyType} strategy, got ${(strategy as AnyStrategy).strategyType}`
    );
  }
  return strategy as Strategy<S>;
}
