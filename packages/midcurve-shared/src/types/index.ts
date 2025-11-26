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
  AnyToken,
} from './token.js';
export type { Erc20TokenConfig } from './token-config.js';

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

// Hedge types
export type {
  Hedge,
  HyperliquidPerpHedge,
  AnyHedge,
} from './hedge.js';

export {
  isHyperliquidPerpHedge,
  assertHyperliquidPerpHedge,
  narrowHedgeType,
} from './hedge.js';

export type {
  HedgeConfigMap,
  HedgeType,
  HedgeProtocol,
} from './hedge-config.js';

export { getHedgeProtocol } from './hedge-config.js';

// Hedge Ledger Event types
export type {
  HedgeLedgerEvent,
  HedgeEventType,
  HedgeTokenAmount,
} from './hedge-ledger-event.js';

// Hyperliquid types (protocol-specific)
export type {
  HyperliquidPerpHedgeConfig,
  HyperliquidAccountType,
  HyperliquidMarginMode,
  HyperliquidEnvironment,
  HyperliquidAccountConfig,
  HyperliquidMarketConfig,
  HyperliquidHedgeParams,
  HyperliquidRiskLimits,
  HyperliquidPositionLinks,
  HyperliquidPerpHedgeState,
  HyperliquidDataSource,
  HyperliquidPositionStatus,
  HyperliquidOrderSide,
  HyperliquidPositionSide,
  HyperliquidPositionValue,
  HyperliquidPositionLeverage,
  HyperliquidPositionFunding,
  HyperliquidPosition,
  HyperliquidOrder,
  HyperliquidAccountSnapshot,
  HyperliquidRawData,
  HyperliquidHedgeLedgerEventConfig,
  HyperliquidHedgeLedgerEventState,
  HyperliquidTradeEvent,
  HyperliquidFundingEvent,
  HyperliquidLiquidationEvent,
} from './hyperliquid/index.js';

export {
  isHyperliquidTradeEvent,
  isHyperliquidFundingEvent,
  isHyperliquidLiquidationEvent,
} from './hyperliquid/index.js';

// Hyperliquid subaccount types and utilities
export type { HyperliquidSubaccountInfo } from './hyperliquid/index.js';
export {
  SUBACCOUNT_ACTIVE_PREFIX,
  SUBACCOUNT_UNUSED_PREFIX,
  generateSubaccountName,
  generateUnusedName,
  isActiveSubaccountName,
  isUnusedSubaccountName,
  isMidcurveSubaccount,
  extractUnusedIndex,
} from './hyperliquid/index.js';

// Risk layer types
export type {
  RiskAssetId,
  RiskAssetRole,
  RiskAsset,
  PositionRiskPair,
  HedgeEligibility,
  PositionRiskView,
} from './risk/index.js';
