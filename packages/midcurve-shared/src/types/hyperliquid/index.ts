/**
 * Hyperliquid specific types (shared across API, UI, Workers)
 */

// Hedge configuration types
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
} from './hedge-config.js';

// Subaccount types and utilities
export type { HyperliquidSubaccountInfo } from './subaccount.js';
export {
  SUBACCOUNT_ACTIVE_PREFIX,
  SUBACCOUNT_UNUSED_PREFIX,
  generateSubaccountName,
  generateUnusedName,
  isActiveSubaccountName,
  isUnusedSubaccountName,
  isMidcurveSubaccount,
  extractUnusedIndex,
} from './subaccount.js';

// Hedge state types
export type {
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
} from './hedge-state.js';

// Hedge ledger event types
export type {
  HyperliquidHedgeLedgerEventConfig,
  HyperliquidHedgeLedgerEventState,
  HyperliquidTradeEvent,
  HyperliquidFundingEvent,
  HyperliquidLiquidationEvent,
} from './hedge-ledger-event.js';

// Type guards
export {
  isHyperliquidTradeEvent,
  isHyperliquidFundingEvent,
  isHyperliquidLiquidationEvent,
} from './hedge-ledger-event.js';
