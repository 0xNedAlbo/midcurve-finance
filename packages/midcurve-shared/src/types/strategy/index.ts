/**
 * Strategy Intent Types
 *
 * Permission grant documents for automated strategy authorization.
 */

// Allowed currency types
export type {
  AllowedCurrencyType,
  Erc20AllowedCurrency,
  EvmNativeAllowedCurrency,
  AllowedCurrency,
} from './allowed-currency.js';

export { isErc20Currency, isEvmNativeCurrency } from './allowed-currency.js';

// Allowed effect types
export type {
  AllowedEffectType,
  EvmContractCallEffect,
  AllowedEffect,
} from './allowed-effect.js';

export { isEvmContractCallEffect } from './allowed-effect.js';

// Strategy envelope types
export type {
  StrategyType,
  StrategyConfigMap,
  StrategyEnvelope,
  AnyStrategyEnvelope,
} from './strategy-envelope.js';

export { isBasicUniswapV3Strategy } from './strategy-envelope.js';

// Strategy intent types
export type {
  StrategyIntentV1,
  AnyStrategyIntent,
  SignedStrategyIntentV1,
} from './strategy-intent.js';

// Strategy config types
export type { BasicUniswapV3StrategyConfig } from './configs/index.js';
