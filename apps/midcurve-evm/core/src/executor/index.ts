/**
 * Executor Module Exports
 *
 * Provides the executor pool and related utilities
 * for processing effect requests.
 */

// Executor classes
export { Executor, type ExecutorConfig, type ExecutorStats } from './executor.js';
export {
  ExecutorPool,
  type ExecutorPoolConfig,
  type ExecutorPoolStats,
} from './pool.js';

// Handler registry
export { EffectHandlerRegistry } from './handlers/registry.js';

// Handler types
export type { EffectHandler, EffectHandlerResult } from './handlers/types.js';

// Built-in handlers
export { LogEffectHandler } from './handlers/log-handler.js';
export {
  OhlcSubscribeHandler,
  OhlcUnsubscribeHandler,
  EFFECT_SUBSCRIBE_OHLC,
  EFFECT_UNSUBSCRIBE_OHLC,
} from './handlers/ohlc-handler.js';
