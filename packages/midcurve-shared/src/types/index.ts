/**
 * Shared types for Midcurve Finance
 * Used across API, UI, and Workers
 */

// User types
export type { User } from './user.js';

// Authentication types
export type { AuthWalletAddress } from './auth-wallet-address.js';
export type { ApiKeyDisplay } from './api-key.js';

// Token types (OOP inheritance pattern)
export type {
  TokenInterface,
  TokenType,
  TokenJSON,
  BaseTokenParams,
  TokenRow,
} from './token/index.js';
export {
  BaseToken,
  TokenFactory,
  Erc20Token,
  Erc20TokenConfig,
  BasicCurrencyToken,
  BasicCurrencyConfig,
} from './token/index.js';
export type {
  Erc20TokenParams,
  Erc20TokenRow,
  Erc20TokenConfigData,
  Erc20TokenConfigJSON,
  BasicCurrencyTokenParams,
  BasicCurrencyTokenRow,
  BasicCurrencyConfigData,
  BasicCurrencyConfigJSON,
} from './token/index.js';

// Token types (legacy - to be removed after migration)
export type {
  Token,
  TokenConfigMap,
  Erc20Token as Erc20TokenLegacy,
  BasicCurrencyToken as BasicCurrencyTokenLegacy,
  AnyToken,
  Erc20TokenConfig as Erc20TokenConfigLegacy,
  BasicCurrencyConfig as BasicCurrencyConfigLegacy,
} from './token.js';

// Pool types (OOP inheritance pattern)
export type {
  PoolInterface,
  Protocol,
  PoolType,
  PoolJSON,
  BasePoolParams,
  PoolRow,
} from './pool/index.js';
export {
  BasePool,
  PoolFactory,
  UniswapV3Pool,
  UniswapV3PoolConfig,
} from './pool/index.js';
export type {
  UniswapV3PoolParams,
  UniswapV3PoolRow,
  UniswapV3PoolConfigData,
  UniswapV3PoolConfigJSON,
  UniswapV3PoolState,
  UniswapV3PoolStateJSON,
} from './pool/index.js';
export { stateToJSON, stateFromJSON } from './pool/index.js';

// Pool types (legacy - to be removed after migration)
export type { Pool, AnyPool } from './pool.js';
export type { PoolConfigMap } from './pool-config.js';

// Position types (OOP inheritance pattern)
export type {
  PositionInterface,
  PositionJSON,
  BasePositionParams,
  PositionRow,
} from './position/index.js';
export {
  BasePosition,
  PositionFactory,
} from './position/index.js';

// Note: PositionProtocol and PositionType are now exported from ./position/index.js
// Keeping legacy exports below for backward compatibility

// Uniswap V3 Position (OOP pattern)
export { UniswapV3Position, UniswapV3PositionConfig } from './position/index.js';
export type {
  UniswapV3PositionParams,
  UniswapV3PositionRow,
  UniswapV3PositionConfigData,
  UniswapV3PositionConfigJSON,
  UniswapV3PositionState as UniswapV3PositionStateNew,
  UniswapV3PositionStateJSON,
} from './position/index.js';
export {
  positionStateToJSON,
  positionStateFromJSON,
} from './position/index.js';

// Position types (legacy - to be removed after migration)
export type {
  Position,
  PositionProtocol,
  PositionType,
  PositionConfigMap,
  UniswapV3Position as UniswapV3PositionLegacy,
  AnyPosition,
} from './position.js';

// Position utility functions (legacy - now methods on BasePosition)
export {
  getBaseToken,
  getQuoteToken,
  isUniswapV3Position,
  assertUniswapV3Position,
  narrowPositionProtocol,
  getTotalRealizedPnl,
  getTotalUnrealizedPnl,
} from './position.js';

// PoolPrice types (OOP inheritance pattern)
export type {
  PoolPriceInterface,
  PoolPriceProtocol,
  PoolPriceJSON,
  BasePoolPriceParams,
  PoolPriceRow,
} from './pool-price/index.js';
export {
  BasePoolPrice,
  PoolPriceFactory,
  UniswapV3PoolPrice,
} from './pool-price/index.js';
export type {
  UniswapV3PoolPriceParams,
  UniswapV3PoolPriceRow,
  UniswapV3PoolPriceConfig,
  UniswapV3PoolPriceConfigJSON,
  UniswapV3PoolPriceState,
  UniswapV3PoolPriceStateJSON,
} from './pool-price/index.js';
export {
  configToJSON as poolPriceConfigToJSON,
  configFromJSON as poolPriceConfigFromJSON,
  priceStateToJSON,
  priceStateFromJSON,
} from './pool-price/index.js';

// Pool price types (legacy - to be removed after migration)
export type { PoolPrice, AnyPoolPrice } from './pool-price.js';
export type { PoolPriceConfigMap } from './pool-price-config.js';

// Position Ledger Event types (OOP inheritance pattern)
export type {
  PositionLedgerEventInterface,
  LedgerEventProtocol,
  EventType,
  Reward,
  RewardJSON,
  PositionLedgerEventJSON,
  BasePositionLedgerEventParams,
  PositionLedgerEventRow,
} from './position-ledger-event/index.js';
export {
  rewardToJSON,
  rewardFromJSON,
  BasePositionLedgerEvent,
  PositionLedgerEventFactory,
  UniswapV3PositionLedgerEvent,
} from './position-ledger-event/index.js';
export type {
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventConfigJSON,
  UniswapV3LedgerEventState as UniswapV3LedgerEventStateNew,
  UniswapV3LedgerEventStateJSON,
  UniswapV3IncreaseLiquidityEvent as UniswapV3IncreaseLiquidityEventNew,
  UniswapV3DecreaseLiquidityEvent as UniswapV3DecreaseLiquidityEventNew,
  UniswapV3CollectEvent as UniswapV3CollectEventNew,
  UniswapV3IncreaseLiquidityEventJSON,
  UniswapV3DecreaseLiquidityEventJSON,
  UniswapV3CollectEventJSON,
  UniswapV3PositionLedgerEventParams,
  UniswapV3PositionLedgerEventRow,
} from './position-ledger-event/index.js';
export {
  ledgerEventConfigToJSON,
  ledgerEventConfigFromJSON,
  ledgerEventStateToJSON,
  ledgerEventStateFromJSON,
} from './position-ledger-event/index.js';

// Position Ledger Event types (legacy - to be removed after migration)
export type {
  PositionLedgerEvent,
  PositionLedgerEventConfigMap,
  PositionLedgerEventStateMap,
  UniswapV3LedgerEvent,
  AnyLedgerEvent,
} from './position-ledger-event.js';

// Position APR Period types
export type { PositionAprPeriod, AprPeriodSummary } from './position-apr-period.js';

// Position APR Summary types
export type { AprSummary } from './position-apr-summary.js';

// Quote Token Result types (OOP pattern)
export type {
  QuoteTokenResultProtocol,
  QuoteTokenMatchType,
  QuoteTokenResult,
  QuoteTokenResultJSON,
  UniswapV3QuoteTokenResult,
} from './quote-token-result/index.js';
export {
  quoteTokenResultToJSON,
  quoteTokenResultFromJSON,
  isQuoteTokenResultProtocolSupported,
  createUniswapV3QuoteTokenResult,
} from './quote-token-result/index.js';

// Quote Token Result types (legacy - to be removed after migration)
export type {
  QuoteTokenResult as QuoteTokenResultLegacy,
  UniswapV3QuoteTokenResult as UniswapV3QuoteTokenResultLegacy,
} from './quote-token-result.js';

// Pool Discovery Result types
export type {
  PoolDiscoveryResult,
  UniswapV3PoolDiscoveryResult,
} from './pool-discovery-result.js';

// Uniswap V3 types (protocol-specific, legacy - to be migrated)
// Note: UniswapV3PoolConfig, UniswapV3PoolState, UniswapV3Pool now come from ./pool/index.js
// Note: UniswapV3PoolPriceConfig, UniswapV3PoolPriceState, UniswapV3PoolPrice now come from ./pool-price/index.js
// Note: UniswapV3PositionConfig, UniswapV3PositionState now come from ./position/index.js
// Note: UniswapV3LedgerEventConfig, UniswapV3LedgerEventState now come from ./position-ledger-event/index.js
export type {
  UniswapV3PositionConfig as UniswapV3PositionConfigLegacy,
  UniswapV3PositionState,
  UniswapV3LedgerEventConfig as UniswapV3LedgerEventConfigLegacy,
  UniswapV3LedgerEventState,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
  UniswapV3IncreaseLedgerEvent,
  UniswapV3DecreaseLedgerEvent,
  UniswapV3CollectLedgerEvent,
} from './uniswapv3/index.js';

// ============================================================================
// Automation Types (position automation features)
// ============================================================================

// Close Order types
export type {
  CloseOrderType,
  CloseOrderStatus,
  CloseOrderJSON,
  BaseCloseOrderParams,
  CloseOrderInterface,
  AutomationContractConfig,
} from './automation/index.js';

export { BaseCloseOrder } from './automation/index.js';

// Automation Contract types
export type {
  AutomationContractType,
  AutomationContractJSON,
  BaseAutomationContractParams,
  AutomationContractInterface,
} from './automation/index.js';

export { BaseAutomationContract } from './automation/index.js';

// Pool Subscription types
export type {
  PoolPriceSubscriptionState,
  PoolPriceSubscriptionData,
  PoolPriceSubscriptionJSON,
} from './automation/index.js';

export {
  poolSubscriptionToJSON,
  poolSubscriptionFromJSON,
  emptySubscriptionState,
} from './automation/index.js';

// Automation Factory types
export type {
  AutomationContractRow,
  CloseOrderRow,
} from './automation/index.js';

export {
  AutomationContractFactory,
  CloseOrderFactory,
} from './automation/index.js';

// UniswapV3 Automation types
export type {
  TriggerMode,
  SwapDirection,
  SwapConfig,
  SwapConfigJSON,
  SwapExecution,
  UniswapV3CloseOrderConfigData,
  UniswapV3CloseOrderConfigJSON,
  UniswapV3CloseOrderStateData,
  UniswapV3CloseOrderStateJSON,
  UniswapV3CloseOrderParams,
  UniswapV3CloseOrderRow,
  UniswapV3ContractConfigData,
  UniswapV3ContractConfigJSON,
  UniswapV3ContractStateData,
  UniswapV3ContractStateJSON,
  UniswapV3AutomationContractParams,
  UniswapV3AutomationContractRow,
} from './automation/index.js';

export {
  UniswapV3CloseOrderConfig,
  UniswapV3CloseOrderState,
  UniswapV3CloseOrder,
  UniswapV3ContractConfig,
  UniswapV3ContractState,
  UniswapV3AutomationContract,
} from './automation/index.js';

