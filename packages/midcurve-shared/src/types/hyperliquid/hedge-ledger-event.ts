/**
 * Hyperliquid Hedge Ledger Event Types
 *
 * Protocol-specific config and state for hedge ledger events.
 */

/**
 * Hyperliquid Hedge Ledger Event Config (Immutable)
 *
 * Metadata about the event that doesn't change.
 * Stored in HedgeLedgerEvent.config JSON field.
 */
export interface HyperliquidHedgeLedgerEventConfig {
  /** Market symbol */
  market: string;

  /** Fill ID from Hyperliquid (for trades) */
  fillId?: string;

  /** Order ID that triggered this event */
  orderId?: number;

  /** Client order ID */
  cloid?: string;

  /** Transaction hash (if applicable) */
  txHash?: string;

  /** API timestamp from Hyperliquid */
  apiTimestamp?: number;
}

/**
 * Base trade event structure
 */
interface HyperliquidTradeEventBase {
  /** Execution price */
  executionPx: string;
  /** Size executed */
  size: string;
  /** Fee paid */
  fee: string;
  /** Position size after this event */
  positionSizeAfter: string;
  /** Side of the trade */
  side: 'buy' | 'sell';
  /** Is this a liquidation trade */
  isLiquidation: boolean;
}

/**
 * Trade event - for OPEN, INCREASE, DECREASE, CLOSE
 */
export interface HyperliquidTradeEvent extends HyperliquidTradeEventBase {
  eventType: 'TRADE';
}

/**
 * Funding payment event
 */
export interface HyperliquidFundingEvent {
  eventType: 'FUNDING';
  /** Funding rate at the time */
  fundingRate: string;
  /** Funding payment amount (positive = received, negative = paid) */
  fundingPayment: string;
  /** Position size at funding time */
  positionSize: string;
  /** Position notional at funding time */
  positionNotional: string;
}

/**
 * Liquidation event
 */
export interface HyperliquidLiquidationEvent {
  eventType: 'LIQUIDATION';
  /** Liquidation price */
  liquidationPx: string;
  /** Size liquidated */
  sizeLiquidated: string;
  /** Loss from liquidation */
  liquidationLoss: string;
  /** Insurance fund contribution */
  insuranceFundContribution?: string;
}

/**
 * Hyperliquid Hedge Ledger Event State (Discriminated Union)
 *
 * Raw event data from Hyperliquid API.
 * Stored in HedgeLedgerEvent.state JSON field.
 */
export type HyperliquidHedgeLedgerEventState =
  | HyperliquidTradeEvent
  | HyperliquidFundingEvent
  | HyperliquidLiquidationEvent;

/**
 * Type guard for trade events
 */
export function isHyperliquidTradeEvent(
  state: HyperliquidHedgeLedgerEventState
): state is HyperliquidTradeEvent {
  return state.eventType === 'TRADE';
}

/**
 * Type guard for funding events
 */
export function isHyperliquidFundingEvent(
  state: HyperliquidHedgeLedgerEventState
): state is HyperliquidFundingEvent {
  return state.eventType === 'FUNDING';
}

/**
 * Type guard for liquidation events
 */
export function isHyperliquidLiquidationEvent(
  state: HyperliquidHedgeLedgerEventState
): state is HyperliquidLiquidationEvent {
  return state.eventType === 'LIQUIDATION';
}
