/**
 * Shared types for Midcurve Finance
 * Used across API, UI, and Workers
 */

// User types
export type { User } from './user.js';

// Authentication types
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
  UniswapV3PositionMetrics,
  UniswapV3PositionPnLSummary,
  AnyPosition,
} from './position/index.js';
export {
  positionStateToJSON,
  positionStateFromJSON,
  CloseOrderSimulationOverlay,
  INFINITE_RUNUP,
} from './position/index.js';
export type {
  PnLScenario,
  CloseOrderSimulationOverlayParams,
  PostTriggerExposure,
  UniswapV3SimulationParams,
  PnLSimulationResult,
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
  UniswapV3MintEvent,
  UniswapV3BurnEvent,
  UniswapV3TransferEvent,
  UniswapV3IncreaseLiquidityEventJSON,
  UniswapV3DecreaseLiquidityEventJSON,
  UniswapV3CollectEventJSON,
  UniswapV3MintEventJSON,
  UniswapV3BurnEventJSON,
  UniswapV3TransferEventJSON,
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
// ============================================================================
// Automation Types (position automation features)
// ============================================================================

// On-Chain Close Order types (contract enum mirrors)
export {
  OnChainOrderStatus,
  ContractTriggerMode,
  ContractSwapDirection,
  AUTOMATION_STATES,
} from './automation/index.js';
export type { AutomationState } from './automation/index.js';

// UniswapV3 Automation types
export type {
  TriggerMode,
  SwapDirection,
  SwapConfig,
} from './automation/index.js';

// UniswapV3 Close Order config/state types
export type {
  UniswapV3CloseOrderConfig,
  UniswapV3CloseOrderState,
} from './automation/index.js';

export {
  createUniswapV3OrderIdentityHash,
  createEmptyUniswapV3CloseOrderState,
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
  buildMidcurveSwapRouterHash,
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

// ============================================================================
// CoinGecko Token types (lookup table for token enrichment)
// ============================================================================

export type {
  CoingeckoTokenConfigData,
  CoingeckoTokenConfigJSON,
  CoingeckoTokenParams,
  CoingeckoTokenRow,
  CoingeckoTokenJSON,
} from './coingecko-token/index.js';
export {
  CoingeckoTokenConfig,
  CoingeckoToken,
} from './coingecko-token/index.js';

// ============================================================================
// Onchain Subscription Types (WebSocket event subscriptions)
// ============================================================================

export type {
  OnchainSubscriptionType,
  OnchainSubscriptionStatus,
  OnchainSubscriptionData,
  OnchainSubscriptionJSON,
  // ERC-20 Approval
  Erc20ApprovalSubscriptionConfig,
  Erc20ApprovalSubscriptionState,
  Erc20ApprovalSubscriptionData,
  Erc20ApprovalSubscriptionJSON,
  // ERC-20 Balance
  Erc20BalanceSubscriptionConfig,
  Erc20BalanceSubscriptionState,
  Erc20BalanceSubscriptionData,
  Erc20BalanceSubscriptionJSON,
  // EVM Transaction Status
  TxStatusValue,
  EvmTxStatusSubscriptionConfig,
  EvmTxStatusSubscriptionState,
  EvmTxStatusSubscriptionData,
  EvmTxStatusSubscriptionJSON,
  // Uniswap V3 Pool Price
  UniswapV3PoolPriceSubscriptionConfig,
  UniswapV3PoolPriceSubscriptionState,
  UniswapV3PoolPriceSubscriptionData,
  UniswapV3PoolPriceSubscriptionJSON,
} from './onchain-subscription/index.js';

export {
  // ERC-20 Approval
  emptyErc20ApprovalState,
  isErc20ApprovalSubscription,
  // ERC-20 Balance
  emptyErc20BalanceState,
  isErc20BalanceSubscription,
  // EVM Transaction Status
  emptyEvmTxStatusState,
  isEvmTxStatusSubscription,
  // Uniswap V3 Pool Price
  emptyUniswapV3PoolPriceState,
  isUniswapV3PoolPriceSubscription,
  // Common
  subscriptionToJSON,
  subscriptionFromJSON,
  MAX_UINT256,
  isUnlimitedApproval,
  hasApproval,
} from './onchain-subscription/index.js';
