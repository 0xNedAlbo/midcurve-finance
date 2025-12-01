/**
 * Strategy Implementation Interface
 *
 * Base interface that all strategy implementations must implement.
 * Strategies are stateless functions that receive context and return new state.
 */

import type {
  StrategyType,
  StrategyConfigMap,
  StrategyEvent,
} from '@midcurve/shared';
import type { StrategyRuntimeApi } from './strategy-runtime-api.js';

/**
 * Strategy context provided to run()
 *
 * Contains all information needed to process an event:
 * - Strategy identity
 * - Configuration and current state
 * - External state (pool data, prices, etc.)
 * - The event to process
 * - Runtime API for effects
 */
export interface StrategyContext<
  S extends StrategyType,
  TExternalState = unknown
> {
  /** Strategy ID */
  strategyId: string;

  /** Strategy type */
  strategyType: S;

  /** User ID who owns this strategy */
  userId: string;

  /** Immutable strategy configuration */
  config: StrategyConfigMap[S]['config'];

  /** Current local state (mutable by returning new state) */
  localState: StrategyConfigMap[S]['state'];

  /** External state (read-only, e.g., pool data) */
  externalState: TExternalState;

  /** The event to process */
  event: StrategyEvent;

  /** Runtime API for executing effects */
  api: StrategyRuntimeApi;
}

/**
 * Strategy Implementation Interface
 *
 * All strategy implementations must implement this interface.
 * The run() method is called for each event and returns the new local state.
 *
 * Key principles:
 * - Strategies are pure functions (deterministic given same inputs)
 * - Side effects are performed through the api.startEffect() method
 * - State changes are returned from run(), not mutated in place
 * - Strategies should be idempotent when possible
 *
 * @template S - Strategy type
 * @template TExternalState - Type of external state
 */
export interface StrategyImplementation<
  S extends StrategyType,
  TExternalState = unknown
> {
  /** Strategy type this implementation handles */
  readonly strategyType: S;

  /**
   * Process an event and return new local state
   *
   * Called for each event in the strategy's mailbox.
   * Should be fast (< 100ms) and not perform blocking operations.
   *
   * @param ctx - Strategy context with all needed data
   * @returns New local state (or same state if no changes)
   */
  run(ctx: StrategyContext<S, TExternalState>): Promise<StrategyConfigMap[S]['state']>;

  /**
   * Initialize strategy when first activated
   *
   * Called once when strategy transitions from 'pending' to 'active'.
   * Use this to set up initial subscriptions, validate config, etc.
   *
   * @param ctx - Strategy context (event will be a synthetic 'init' event)
   * @returns Initial local state
   */
  initialize?(ctx: Omit<StrategyContext<S, TExternalState>, 'event'>): Promise<StrategyConfigMap[S]['state']>;

  /**
   * Clean up when strategy is stopped
   *
   * Called when strategy transitions to 'stopped', 'completed', or 'error'.
   * Use this to unsubscribe from data feeds, cancel pending effects, etc.
   *
   * @param ctx - Strategy context
   */
  shutdown?(ctx: Omit<StrategyContext<S, TExternalState>, 'event'>): Promise<void>;
}
