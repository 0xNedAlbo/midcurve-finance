/**
 * Strategy Intent Schemas
 *
 * Zod validation schemas for strategy intent documents.
 */

// Common helper schemas
export {
  EvmAddressSchema,
  ChainIdSchema,
  FunctionSelectorSchema,
  HexSchema,
} from './common-schemas.js';

// Allowed currency schemas
export {
  Erc20AllowedCurrencySchema,
  EvmNativeAllowedCurrencySchema,
  AllowedCurrencySchema,
  AllowedCurrenciesSchema,
  type ValidatedErc20AllowedCurrency,
  type ValidatedEvmNativeAllowedCurrency,
  type ValidatedAllowedCurrency,
  type ValidatedAllowedCurrencies,
} from './allowed-currency-schemas.js';

// Allowed effect schemas
export {
  EvmContractCallEffectSchema,
  AllowedEffectSchema,
  AllowedEffectsSchema,
  type ValidatedEvmContractCallEffect,
  type ValidatedAllowedEffect,
  type ValidatedAllowedEffects,
} from './allowed-effect-schemas.js';

// Strategy config registry
export {
  StrategyConfigSchemaRegistry,
  getStrategyConfigSchema,
  validateStrategyConfig,
  isKnownStrategyType,
  getRegisteredStrategyTypes,
} from './strategy-config-registry.js';

// Strategy intent schemas
export {
  StrategyEnvelopeSchema,
  StrategyIntentV1Schema,
  SignedStrategyIntentV1Schema,
  type ValidatedStrategyEnvelope,
  type ValidatedStrategyIntentV1,
  type ValidatedSignedStrategyIntentV1,
} from './strategy-intent-schemas.js';

// Config schemas
export {
  BasicUniswapV3StrategyConfigSchema,
  type ValidatedBasicUniswapV3StrategyConfig,
} from './configs/index.js';
