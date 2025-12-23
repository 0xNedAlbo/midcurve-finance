/**
 * Executor Module Exports
 *
 * Provides the executor pool and related utilities
 * for processing effect requests.
 */

// Executor classes
export { Executor, type ExecutorConfig, type ExecutorStats } from './executor';
export {
  ExecutorPool,
  type ExecutorPoolConfig,
  type ExecutorPoolStats,
} from './pool';

// Handler registry
export { EffectHandlerRegistry } from './handlers/registry';

// Handler types
export type { EffectHandler, EffectHandlerResult } from './handlers/types';

// Built-in handlers
export { LogEffectHandler } from './handlers/log-handler';
export {
  OhlcSubscribeHandler,
  OhlcUnsubscribeHandler,
  EFFECT_SUBSCRIBE_OHLC,
  EFFECT_UNSUBSCRIBE_OHLC,
} from './handlers/ohlc-handler';
