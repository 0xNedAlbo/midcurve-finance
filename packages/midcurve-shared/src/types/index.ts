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
export type { Pool, Protocol, PoolType, UniswapV3Pool, AnyPool, HodlPool } from './pool.js';
export { isHodlPool, assertHodlPool } from './pool.js';
export type { PoolConfigMap } from './pool-config.js';

// Position types
export type {
  Position,
  PositionProtocol,
  PositionType,
  PositionConfigMap,
  UniswapV3Position,
  HodlPosition,
  AnyPosition,
} from './position.js';

// Position utility functions
export {
  getBaseToken,
  getQuoteToken,
  isUniswapV3Position,
  assertUniswapV3Position,
  isHodlPosition,
  assertHodlPosition,
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

// HODL types (protocol-specific)
export type {
  HodlPoolConfig,
  HodlPoolState,
  HodlPositionConfig,
  HodlWalletType,
  HodlEvmOnchainWallet,
  HodlWalletConfig,
  HodlPositionState,
  HodlPositionHolding,
  HodlLedgerEventConfig,
  HodlLedgerEventState,
  HodlEventType,
  HodlExternalDepositEvent,
  HodlExternalWithdrawEvent,
  HodlTradeInEvent,
  HodlTradeOutEvent,
  HodlTradeFeesEvent,
  HodlInternalAllocationInflowEvent,
  HodlInternalAllocationOutflowEvent,
  HodlLedgerEvent,
} from './hodl/index.js';
export { isHodlLedgerEvent, assertHodlLedgerEvent } from './hodl/index.js';

// Strategy types
export type {
  StrategyState,
  StrategyConfig,
  StrategyMetrics,
  StrategyAutomationWallet,
  Strategy,
  AggregationResult,
  PositionWithQuoteToken,
} from './strategy.js';

// Strategy utility functions
export {
  createEmptyMetrics,
  aggregatePositionMetrics,
  getTotalStrategyPnl,
  getTotalRealizedStrategyPnl,
  getTotalUnrealizedStrategyPnl,
  resolveBasicCurrencyId,
  aggregatePositionMetricsWithBasicCurrency,
} from './strategy.js';

// Strategy Manifest types
export type {
  ConstructorParamSource,
  SolidityType,
  ConstructorParamValidation,
  ConstructorParam,
  StrategyCapabilities,
  UserParamType,
  UserParamOption,
  UserParamValidation,
  UserParam,
  StrategyManifest,
} from './strategy-manifest.js';

// Strategy Manifest utility functions
export {
  createEmptyCapabilities,
  hasFundingCapability,
  getUserInputParams,
  hasUserInputParams,
  hasUserParams,
} from './strategy-manifest.js';
