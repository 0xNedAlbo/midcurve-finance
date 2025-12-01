/**
 * Strategy Event Types
 *
 * Events that can be processed by strategy implementations.
 * These are fed into the strategy mailbox and processed sequentially.
 */

/**
 * Strategy event type identifiers
 */
export type StrategyEventType =
  | 'ohlc'
  | 'funding'
  | 'position'
  | 'effect'
  | 'action';

// =============================================================================
// Base Event Interface
// =============================================================================

/**
 * Base strategy event (all events extend this)
 */
export interface BaseStrategyEvent {
  /** Event type discriminator */
  eventType: StrategyEventType;
  /** Strategy ID this event belongs to */
  strategyId: string;
  /** Event timestamp (unix milliseconds) */
  ts: number;
}

// =============================================================================
// OHLC Events (Market Data)
// =============================================================================

/**
 * OHLC candle data
 */
export interface OhlcData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * OHLC market data event
 */
export interface OhlcStrategyEvent extends BaseStrategyEvent {
  eventType: 'ohlc';
  /** Trading symbol (e.g., 'ETH') */
  symbol: string;
  /** Candle timeframe */
  timeframe: '1m';
  /** OHLC data */
  ohlc: OhlcData;
}

// =============================================================================
// Funding Events
// =============================================================================

/**
 * Funding event types
 */
export type FundingEventType = 'deposit' | 'withdraw';

/**
 * Funding deposit/withdraw event
 */
export interface FundingStrategyEvent extends BaseStrategyEvent {
  eventType: 'funding';
  /** Funding event type */
  fundingEventType: FundingEventType;
  /** Amount in token's smallest unit (as string for bigint) */
  amount: string;
  /** Asset/token identifier */
  asset: string;
  /** Transaction ID/hash */
  txId: string;
}

// =============================================================================
// Position Events (On-Chain)
// =============================================================================

/**
 * Position event types
 */
export type PositionEventType =
  | 'increaseLiquidity'
  | 'decreaseLiquidity'
  | 'collect';

/**
 * On-chain position event
 */
export interface PositionStrategyEvent extends BaseStrategyEvent {
  eventType: 'position';
  /** Position event type */
  positionEventType: PositionEventType;
  /** Position ID */
  positionId: string;
  /** Event-specific payload */
  payload: unknown;
}

// =============================================================================
// Effect Events (Execution Results)
// =============================================================================

/**
 * Effect result types
 */
export type EffectResultType = 'success' | 'error' | 'timeout';

/**
 * Effect execution result event
 */
export interface EffectStrategyEvent extends BaseStrategyEvent {
  eventType: 'effect';
  /** Effect result type */
  effectEventType: EffectResultType;
  /** Effect ID that was executed */
  effectId: string;
  /** Result data (on success) */
  result?: unknown;
  /** Error data (on error) */
  error?: unknown;
}

// =============================================================================
// Action Events (User-Initiated)
// =============================================================================

/**
 * User action types
 */
export type StrategyActionType =
  | 'deposit'
  | 'withdraw'
  | 'increasePosition'
  | 'decreasePosition'
  | 'closePosition'
  | 'collect'
  | 'compound'
  | 'rebalance';

/**
 * User action event
 */
export interface ActionStrategyEvent extends BaseStrategyEvent {
  eventType: 'action';
  /** Action ID (from StrategyAction record) */
  actionId: string;
  /** Action type */
  actionType: StrategyActionType;
  /** Action-specific payload */
  payload: unknown;
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all strategy event types
 */
export type StrategyEvent =
  | OhlcStrategyEvent
  | FundingStrategyEvent
  | PositionStrategyEvent
  | EffectStrategyEvent
  | ActionStrategyEvent;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for OHLC event
 */
export function isOhlcEvent(event: StrategyEvent): event is OhlcStrategyEvent {
  return event.eventType === 'ohlc';
}

/**
 * Type guard for Funding event
 */
export function isFundingEvent(
  event: StrategyEvent
): event is FundingStrategyEvent {
  return event.eventType === 'funding';
}

/**
 * Type guard for Position event
 */
export function isPositionEvent(
  event: StrategyEvent
): event is PositionStrategyEvent {
  return event.eventType === 'position';
}

/**
 * Type guard for Effect event
 */
export function isEffectEvent(
  event: StrategyEvent
): event is EffectStrategyEvent {
  return event.eventType === 'effect';
}

/**
 * Type guard for Action event
 */
export function isActionEvent(
  event: StrategyEvent
): event is ActionStrategyEvent {
  return event.eventType === 'action';
}
