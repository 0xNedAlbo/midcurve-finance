/**
 * Hedge Ledger Event Interface
 *
 * Records all financial events for a hedge (trades, funding, liquidations).
 */

/**
 * Event types for hedge ledger events
 */
export type HedgeEventType =
  | 'OPEN'
  | 'INCREASE'
  | 'DECREASE'
  | 'CLOSE'
  | 'FUNDING'
  | 'FEE'
  | 'LIQUIDATION';

/**
 * Token amount in a hedge event
 */
export interface HedgeTokenAmount {
  /** Token ID */
  tokenId: string;
  /** Amount in smallest units (as string for JSON) */
  tokenAmount: string;
  /** Value in quote units (as string for JSON) */
  tokenValue: string;
}

/**
 * Hedge Ledger Event
 *
 * Records a single financial event for a hedge.
 * Similar to PositionLedgerEvent but for hedging instruments.
 */
export interface HedgeLedgerEvent {
  /** Unique identifier */
  id: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Parent hedge ID */
  hedgeId: string;

  /** Event timestamp */
  timestamp: Date;

  /** Type of event */
  eventType: HedgeEventType;

  /** Hash for deduplication */
  inputHash: string;

  // Financial deltas (bigint)

  /** Change in notional value */
  deltaNotional: bigint;

  /** Change in cost basis */
  deltaCostBasis: bigint;

  /** Change in realized PnL */
  deltaRealizedPnl: bigint;

  /** Change in margin (optional) */
  deltaMargin: bigint | null;

  // Token changes

  /** Token amounts involved in this event */
  tokenAmounts: HedgeTokenAmount[];

  // Protocol-specific data

  /** Protocol-specific event configuration */
  config: unknown;

  /** Raw event data from protocol */
  state: unknown;
}
