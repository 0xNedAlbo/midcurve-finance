/**
 * Shared types for Midcurve Finance
 * Used across API, UI, and Workers
 */

// User types
export type { User } from './user.js';

// Authentication types
export type { AuthWalletAddress } from './auth-wallet-address.js';
export type { ApiKeyDisplay } from './api-key.js';

// Token types
export type {
  Token,
  TokenType,
  TokenConfigMap,
  Erc20Token,
  BasicCurrencyToken,
  AnyToken,
} from './token.js';
export type { Erc20TokenConfig, BasicCurrencyConfig } from './token-config.js';

// Pool types
export type { Pool, Protocol, PoolType, UniswapV3Pool, AnyPool } from './pool.js';
export type { PoolConfigMap } from './pool-config.js';

// Position types
export type {
  Position,
  PositionProtocol,
  PositionType,
  PositionConfigMap,
  UniswapV3Position,
  AnyPosition,
} from './position.js';

// Position utility functions
export {
  getBaseToken,
  getQuoteToken,
  isUniswapV3Position,
  assertUniswapV3Position,
  narrowPositionProtocol,
  getTotalRealizedPnl,
  getTotalUnrealizedPnl,
} from './position.js';

// Pool price types
export type {
  PoolPrice,
  PoolPriceProtocol,
  PoolPriceConfigMap,
  UniswapV3PoolPrice,
  AnyPoolPrice,
} from './pool-price.js';

// Position Ledger Event types
export type {
  PositionLedgerEvent,
  EventType,
  Reward,
  LedgerEventProtocol,
  PositionLedgerEventConfigMap,
  PositionLedgerEventStateMap,
  UniswapV3LedgerEvent,
  AnyLedgerEvent,
} from './position-ledger-event.js';

// Position APR Period types
export type { PositionAprPeriod, AprPeriodSummary } from './position-apr-period.js';

// Position APR Summary types
export type { AprSummary } from './position-apr-summary.js';

// Quote Token Result types
export type {
  QuoteTokenResult,
  UniswapV3QuoteTokenResult,
} from './quote-token-result.js';

// Pool Discovery Result types
export type {
  PoolDiscoveryResult,
  UniswapV3PoolDiscoveryResult,
} from './pool-discovery-result.js';

// Uniswap V3 types (protocol-specific)
export type {
  UniswapV3PoolConfig,
  UniswapV3PoolState,
  UniswapV3PositionConfig,
  UniswapV3PositionState,
  UniswapV3PoolPriceConfig,
  UniswapV3PoolPriceState,
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventState,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
  UniswapV3IncreaseLedgerEvent,
  UniswapV3DecreaseLedgerEvent,
  UniswapV3CollectLedgerEvent,
} from './uniswapv3/index.js';

// Strategy types
export type {
  StrategyState,
  StrategyStatus,
  StrategyConfig,
  StrategyMetrics,
  StrategyAutomationWallet,
  Strategy,
} from './strategy.js';

// Strategy Position types (strategy-owned positions)
export type {
  StrategyPositionStatus,
  StrategyPositionType,
  StrategyPositionJSON,
  BaseStrategyPositionParams,
  StrategyPositionMetrics,
  StrategyPositionInterface,
  StrategyPositionRow,
  // Treasury strategy position types
  TreasuryConfigData,
  TreasuryStateData,
  StrategyTreasuryParams,
  StrategyTreasuryRow,
  TreasuryHolding,
  TreasuryHoldingJSON,
  TreasuryWalletType,
  TreasuryEvmOnchainWallet,
  TreasuryWalletConfig,
} from './strategy-position/index.js';

export {
  BaseStrategyPosition,
  StrategyPositionFactory,
  // Treasury strategy position classes
  TreasuryConfig,
  TreasuryState,
  StrategyTreasury,
  holdingToJSON,
  holdingFromJSON,
} from './strategy-position/index.js';

// Strategy Ledger Event types (strategy-owned ledger events)
export type {
  StrategyLedgerEventType,
  TokenHashComponents,
  StrategyLedgerEvent,
  StrategyLedgerEventJSON,
  StrategyLedgerEventRow,
} from './strategy-ledger-event/index.js';

export {
  EVENT_TYPE_CATEGORIES,
  isFundingEvent,
  isAssetMovementEvent,
  isPositionLifecycleEvent,
  isIncomeEvent,
  isCostEvent,
  isInternalEvent,
  makeTokenHash,
  parseTokenHash,
  isValidTokenHash,
  getChainIdFromTokenHash,
  getAddressFromTokenHash,
  getTokenTypeFromTokenHash,
  strategyLedgerEventToJSON,
  strategyLedgerEventFromJSON,
  strategyLedgerEventFromRow,
} from './strategy-ledger-event/index.js';

// Strategy utility functions
export {
  getStrategyUnrealizedCapitalGain,
  getStrategyTotalUnrealizedPnl,
  getStrategyTotalRealizedPnl,
  getStrategyTotalPnl,
  // Deprecated aliases for backwards compatibility
  getTotalStrategyPnl,
  getTotalRealizedStrategyPnl,
  getTotalUnrealizedStrategyPnl,
} from './strategy.js';

// Strategy Manifest types
export type {
  ConstructorParamSource,
  SolidityType,
  ParamUIElement,
  LayoutUIElement,
  ConstructorParamUI,
  ConstructorParam,
  LayoutElement,
  FormItem,
  StrategyManifest,
} from './strategy-manifest.js';

// Strategy Manifest utility functions
export {
  getUserInputParams,
  hasUserInputParams,
  getDefaultUIElement,
} from './strategy-manifest.js';
