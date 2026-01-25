/**
 * Shared types for Midcurve Finance
 * Used across API, UI, and Workers
 */

// User types
export type { User } from './user.js';

// Authentication types
export type { AuthWalletAddress } from './auth-wallet-address.js';
export type { ApiKeyDisplay } from './api-key.js';

// ============================================================================
// Token types (OOP inheritance pattern)
// ============================================================================

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

// ============================================================================
// Pool types (OOP inheritance pattern)
// ============================================================================

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

// ============================================================================
// Position types (OOP inheritance pattern)
// ============================================================================

export type {
  PositionInterface,
  PositionProtocol,
  PositionType,
  PositionJSON,
  BasePositionParams,
  PositionRow,
} from './position/index.js';
export {
  BasePosition,
  PositionFactory,
  UniswapV3Position,
  UniswapV3PositionConfig,
} from './position/index.js';
export type {
  UniswapV3PositionParams,
  UniswapV3PositionRow,
  UniswapV3PositionConfigData,
  UniswapV3PositionConfigJSON,
  UniswapV3PositionState,
  UniswapV3PositionStateJSON,
  AnyPosition,
} from './position/index.js';
export {
  positionStateToJSON,
  positionStateFromJSON,
} from './position/index.js';

// ============================================================================
// PoolPrice types (OOP inheritance pattern)
// ============================================================================

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

// ============================================================================
// Position Ledger Event types (OOP inheritance pattern)
// ============================================================================

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
  UniswapV3LedgerEventState,
  UniswapV3LedgerEventStateJSON,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
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

// ============================================================================
// Position APR types
// ============================================================================

export type { PositionAprPeriod, AprPeriodSummary } from './position-apr-period.js';
export type { AprSummary } from './position-apr-summary.js';

// ============================================================================
// Quote Token Result types
// ============================================================================

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

// ============================================================================
// Pool Discovery Result types
// ============================================================================

export type {
  PoolDiscoveryResult,
  UniswapV3PoolDiscoveryResult,
} from './pool-discovery-result.js';

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

// ============================================================================
// Shared Contract Types (platform-independent contract registry)
// ============================================================================

export type {
  SharedContractType,
  SharedContractName,
  SharedContractStatus,
  SharedContractData,
  SharedContractJSON,
} from './shared-contract/index.js';

export {
  SharedContractType as SharedContractTypeEnum,
  SharedContractName as SharedContractNameEnum,
} from './shared-contract/index.js';

export {
  buildSharedContractHash,
  parseSharedContractHash,
  buildUniswapV3PositionCloserHash,
  parseInterfaceVersion,
  buildInterfaceVersion,
} from './shared-contract/index.js';

// EVM shared contract types
export type {
  EvmSmartContractConfigData,
  EvmSmartContractConfigJSON,
  EvmSharedContract,
  EvmSharedContractJSON,
  UniswapV3PositionCloserContract,
  UniswapV3PositionCloserContractJSON,
} from './shared-contract/index.js';

export { EvmSmartContractConfig } from './shared-contract/index.js';
