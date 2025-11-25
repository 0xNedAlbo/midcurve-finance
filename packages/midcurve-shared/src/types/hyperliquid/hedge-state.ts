/**
 * Hyperliquid Perpetual Hedge State (Mutable)
 * Stored in Hedge.state JSON field
 *
 * This is the TypeScript interface matching the Zod schema in @midcurve/services
 * for use across all packages without Zod dependency.
 */

/**
 * Data source for the last sync
 */
export type HyperliquidDataSource =
  | 'info.webData2'
  | 'info.clearinghouseState'
  | 'ws.webData2';

/**
 * Position status on Hyperliquid
 */
export type HyperliquidPositionStatus =
  | 'none'
  | 'open'
  | 'closing'
  | 'closed'
  | 'liquidated';

/**
 * Order side
 */
export type HyperliquidOrderSide = 'buy' | 'sell';

/**
 * Position side
 */
export type HyperliquidPositionSide = 'long' | 'short';

/**
 * Position value metrics
 */
export interface HyperliquidPositionValue {
  /** Current position value in quote currency */
  positionValue: string;
  /** Unrealized PnL */
  unrealizedPnl: string;
  /** Realized PnL */
  realizedPnl: string;
  /** Return on equity */
  returnOnEquity?: string;
}

/**
 * Position leverage details
 */
export interface HyperliquidPositionLeverage {
  /** Margin mode */
  mode: 'cross' | 'isolated';
  /** Current leverage value */
  value: number;
  /** Maximum leverage available */
  maxLeverage?: number;
  /** Margin used for this position */
  marginUsed: string;
}

/**
 * Position funding details
 */
export interface HyperliquidPositionFunding {
  /** Cumulative funding paid/received all time */
  cumFundingAllTime: string;
  /** Cumulative funding since position opened */
  cumFundingSinceOpen: string;
  /** Cumulative funding since last size change */
  cumFundingSinceChange: string;
  /** Current funding rate */
  currentFundingRate?: string;
}

/**
 * Position details on Hyperliquid
 */
export interface HyperliquidPosition {
  /** Asset symbol */
  coin: string;
  /** Signed size (Hyperliquid szi format) */
  szi: string;
  /** Position side */
  side: HyperliquidPositionSide;
  /** Absolute size */
  absSize: string;

  /** Entry price */
  entryPx: string;
  /** Mark price */
  markPx?: string;
  /** Index price */
  indexPx?: string;
  /** Liquidation price */
  liquidationPx?: string;

  /** Value metrics */
  value: HyperliquidPositionValue;

  /** Leverage details */
  leverage: HyperliquidPositionLeverage;

  /** Funding details */
  funding: HyperliquidPositionFunding;

  /** Timestamp of last position change (milliseconds) */
  lastChangeTime?: number;
}

/**
 * Open order on Hyperliquid
 */
export interface HyperliquidOrder {
  /** Order ID */
  oid: number;
  /** Client order ID */
  cloid?: string;
  /** Order side */
  side: HyperliquidOrderSide;
  /** Is reduce-only order */
  isReduceOnly: boolean;
  /** Is position TP/SL order */
  isPositionTpsl: boolean;

  /** Order type (e.g., "Limit", "Market", "Trigger") */
  orderType: string;
  /** Limit price */
  limitPx: string;
  /** Trigger price (for trigger orders) */
  triggerPx?: string;
  /** Trigger condition */
  triggerCondition?: string;
  /** Is trigger order */
  isTrigger: boolean;
  /** Time in force (e.g., "Gtc") */
  tif: string;

  /** Current size */
  sz: string;
  /** Original size */
  origSz?: string;

  /** Asset symbol */
  coin: string;
  /** Order creation timestamp (milliseconds) */
  createdAt: number;
  /** Agent address (for delegated orders) */
  agentAddress?: string;
  /** Agent validity timestamp */
  agentValidUntil?: number;
}

/**
 * Account snapshot
 */
export interface HyperliquidAccountSnapshot {
  /** Total account value */
  accountValue: string;
  /** Total notional position value */
  totalNtlPos: string;
  /** Total margin used */
  totalMarginUsed: string;
  /** Withdrawable amount */
  withdrawable: string;
}

/**
 * Raw API responses (for debugging/auditing)
 */
export interface HyperliquidRawData {
  /** Last webData2 response */
  lastWebData2?: unknown;
  /** Last clearinghouseState response */
  lastClearinghouseState?: unknown;
}

/**
 * Hyperliquid Perpetual Hedge State
 *
 * This is MUTABLE state that changes with each sync.
 * Stored in Hedge.state JSON field.
 */
export interface HyperliquidPerpHedgeState {
  /** Schema version for migration support */
  schemaVersion: 1;

  /** Last sync timestamp (ISO string) */
  lastSyncAt: string;

  /** Source of the last sync data */
  lastSource: HyperliquidDataSource;

  /** Current position status */
  positionStatus: HyperliquidPositionStatus;

  /** Position details (if open) */
  position?: HyperliquidPosition;

  /** Open orders */
  orders: {
    /** List of open orders */
    open: HyperliquidOrder[];
    /** Last order client ID (for tracking) */
    lastOrderCloid?: string;
  };

  /** Account snapshot (optional) */
  accountSnapshot?: HyperliquidAccountSnapshot;

  /** Raw API data (optional, for debugging) */
  raw?: HyperliquidRawData;
}
