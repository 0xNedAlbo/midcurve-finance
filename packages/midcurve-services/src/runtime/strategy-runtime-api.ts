/**
 * Strategy Runtime API
 *
 * Interface for strategy implementations to interact with the runtime.
 * Provides effect execution, subscription management, and other runtime capabilities.
 */

/**
 * Effect input for strategy effects
 */
export interface EffectInput {
  /** Effect type (e.g., 'swap', 'increaseLiquidity', 'decreaseLiquidity') */
  effectType: string;
  /** Effect-specific payload */
  payload: unknown;
  /** Optional timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/**
 * OHLC subscription input
 */
export interface OhlcSubscriptionInput {
  /** Trading symbol (e.g., 'ETH') */
  symbol: string;
  /** Candle timeframe */
  timeframe: '1m';
}

/**
 * Strategy Runtime API
 *
 * Provided to strategy implementations during execution.
 * Allows strategies to:
 * - Execute effects (swaps, liquidity changes)
 * - Subscribe/unsubscribe to market data
 * - Access runtime utilities
 */
export interface StrategyRuntimeApi {
  /**
   * Start an effect execution
   *
   * Effects are async operations that may take time to complete.
   * The strategy should track the effectId in local state and
   * wait for an EffectStrategyEvent with the result.
   *
   * @param input - Effect configuration
   * @returns Effect ID for tracking
   */
  startEffect(input: EffectInput): string;

  /**
   * Subscribe to OHLC market data
   *
   * Strategy will receive OhlcStrategyEvent for each candle.
   *
   * @param input - Subscription configuration
   */
  subscribeOhlc(input: OhlcSubscriptionInput): void;

  /**
   * Unsubscribe from OHLC market data
   *
   * @param input - Subscription to cancel
   */
  unsubscribeOhlc(input: OhlcSubscriptionInput): void;

  /**
   * Get current timestamp (milliseconds)
   */
  now(): number;

  /**
   * Log a message (for debugging)
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}
