/**
 * Strategy Types
 *
 * Comprehensive strategy types for automated DeFi position management.
 */

// =============================================================================
// Allowed Currency Types
// =============================================================================

export type {
  AllowedCurrencyType,
  Erc20AllowedCurrency,
  EvmNativeAllowedCurrency,
  AllowedCurrency,
} from './allowed-currency.js';

export { isErc20Currency, isEvmNativeCurrency } from './allowed-currency.js';

// =============================================================================
// Allowed Effect Types
// =============================================================================

export type {
  AllowedEffectType,
  EvmContractCallEffect,
  AllowedEffect,
} from './allowed-effect.js';

export { isEvmContractCallEffect } from './allowed-effect.js';

// =============================================================================
// Strategy Envelope Types
// =============================================================================

export type {
  StrategyType,
  StrategyConfigMap,
  StrategyEnvelope,
  AnyStrategyEnvelope,
} from './strategy-envelope.js';

export { isBasicUniswapV3Strategy } from './strategy-envelope.js';

// =============================================================================
// Strategy Intent Types (EIP-712 Authorization)
// =============================================================================

export type {
  StrategyIntentV1,
  AnyStrategyIntent,
  SignedStrategyIntentV1,
} from './strategy-intent.js';

// =============================================================================
// Strategy Status Types
// =============================================================================

export type { StrategyStatus } from './strategy-status.js';

export {
  isRunnableStatus,
  isTerminatedStatus,
  canResumeFromStatus,
} from './strategy-status.js';

// =============================================================================
// Strategy Entity Types
// =============================================================================

export type {
  Strategy,
  BasicUniswapV3Strategy,
  AnyStrategy,
} from './strategy.js';

export {
  isBasicUniswapV3StrategyType,
  assertBasicUniswapV3Strategy,
  narrowStrategyType,
} from './strategy.js';

// =============================================================================
// Strategy Event Types
// =============================================================================

export type {
  StrategyEventType,
  BaseStrategyEvent,
  OhlcData,
  OhlcStrategyEvent,
  FundingEventType,
  FundingStrategyEvent,
  PositionEventType,
  PositionStrategyEvent,
  EffectResultType,
  EffectStrategyEvent,
  StrategyActionType,
  ActionStrategyEvent,
  StrategyEvent,
} from './strategy-event.js';

export {
  isOhlcEvent,
  isFundingEvent,
  isPositionEvent,
  isEffectEvent,
  isActionEvent,
} from './strategy-event.js';

// =============================================================================
// Strategy Action Types
// =============================================================================

export type { StrategyActionStatus, StrategyAction } from './strategy-action.js';

export {
  isTerminalActionStatus,
  isProcessingActionStatus,
  canCancelAction,
} from './strategy-action.js';

// =============================================================================
// Strategy Config Types
// =============================================================================

export type {
  BasicUniswapV3StrategyConfig,
  BasicUniswapV3StrategyState,
} from './configs/index.js';

export { createInitialBasicUniswapV3State } from './configs/index.js';
