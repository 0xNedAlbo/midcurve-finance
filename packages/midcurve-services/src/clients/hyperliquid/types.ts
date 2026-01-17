/**
 * Hyperliquid Client Types
 *
 * Simplified types for service layer usage.
 * These wrap the raw SDK types for easier consumption.
 */

/**
 * Margin summary for a Hyperliquid account
 */
export interface HyperliquidMarginSummary {
  /** Total account value in USD */
  accountValue: string;
  /** Total notional position value */
  totalNotionalPosition: string;
  /** Total raw USD value */
  totalRawUsd: string;
  /** Total margin used */
  totalMarginUsed: string;
}

/**
 * Leverage configuration for a position
 */
export interface HyperliquidLeverage {
  /** Leverage type: 'isolated' or 'cross' */
  type: 'isolated' | 'cross';
  /** Leverage multiplier */
  value: number;
  /** Raw USD amount (only for isolated) */
  rawUsd?: string;
}

/**
 * Individual position on Hyperliquid
 */
export interface HyperliquidPosition {
  /** Asset symbol (e.g., 'BTC', 'ETH') */
  coin: string;
  /** Signed position size (positive = long, negative = short) */
  size: string;
  /** Average entry price */
  entryPrice: string;
  /** Current position value */
  positionValue: string;
  /** Unrealized profit and loss */
  unrealizedPnl: string;
  /** Return on equity as a decimal */
  returnOnEquity: string;
  /** Liquidation price (null if cross margin with low risk) */
  liquidationPrice: string | null;
  /** Margin used for this position */
  marginUsed: string;
  /** Leverage configuration */
  leverage: HyperliquidLeverage;
  /** Maximum allowed leverage for this asset */
  maxLeverage: number;
}

/**
 * Account state on Hyperliquid (perpetuals)
 */
export interface HyperliquidAccountState {
  /** Margin summary */
  marginSummary: HyperliquidMarginSummary;
  /** Cross-margin summary */
  crossMarginSummary: HyperliquidMarginSummary;
  /** Maintenance margin used for cross positions */
  crossMaintenanceMarginUsed: string;
  /** Amount available for withdrawal */
  withdrawable: string;
  /** List of open positions */
  positions: HyperliquidPosition[];
  /** Timestamp when data was retrieved (ms since epoch) */
  timestamp: number;
}

/**
 * Order side
 */
export type HyperliquidOrderSide = 'buy' | 'sell';

/**
 * Order status
 */
export type HyperliquidOrderStatus = 'open' | 'filled' | 'canceled' | 'triggered' | 'rejected' | 'marginCanceled';

/**
 * Open order on Hyperliquid
 */
export interface HyperliquidOrder {
  /** Order ID */
  orderId: number;
  /** Asset symbol */
  coin: string;
  /** Order side */
  side: HyperliquidOrderSide;
  /** Limit price */
  limitPrice: string;
  /** Order size */
  size: string;
  /** Remaining size */
  remainingSize: string;
  /** Timestamp when order was placed (ms since epoch) */
  timestamp: number;
  /** Order type description */
  orderType: string;
  /** Whether this is a reduce-only order */
  reduceOnly: boolean;
}

/**
 * Asset metadata in perpetuals market
 */
export interface HyperliquidPerpAsset {
  /** Asset name/symbol */
  name: string;
  /** Size decimals for the asset */
  szDecimals: number;
  /** Maximum leverage allowed */
  maxLeverage: number;
  /** Whether only isolated margin is available */
  onlyIsolated: boolean;
}

/**
 * Perpetuals market metadata
 */
export interface HyperliquidPerpsMeta {
  /** List of perpetual assets */
  universe: HyperliquidPerpAsset[];
}

/**
 * Spot token metadata
 */
export interface HyperliquidSpotToken {
  /** Token name */
  name: string;
  /** Size decimals */
  szDecimals: number;
  /** Wei decimals */
  weiDecimals: number;
  /** Token index */
  index: number;
  /** Token ID (if available) */
  tokenId?: string;
  /** Whether it's the chain's native token */
  isCanonical: boolean;
  /** EVM contract address (if available) */
  evmContract: string | null;
  /** Full name of the token */
  fullName: string | null;
}

/**
 * Spot market pair
 */
export interface HyperliquidSpotPair {
  /** Pair name (e.g., 'PURR/USDC') */
  name: string;
  /** Tokens in the pair */
  tokens: [number, number];
  /** Index of the pair */
  index: number;
  /** Whether it's a canonical pair */
  isCanonical: boolean;
}

/**
 * Spot market metadata
 */
export interface HyperliquidSpotMeta {
  /** List of tokens */
  tokens: HyperliquidSpotToken[];
  /** List of spot pairs */
  universe: HyperliquidSpotPair[];
}

/**
 * Asset context with current market data
 */
export interface HyperliquidAssetContext {
  /** Day's change in notional */
  dayNtlVlm: string;
  /** Current funding rate */
  funding: string;
  /** Open interest */
  openInterest: string;
  /** Oracle price */
  oraclePrice: string;
  /** Premium (funding rate component) */
  premium: string;
  /** Previous day's price */
  prevDayPx: string;
  /** Mark price */
  markPx: string;
  /** Mid price */
  midPx: string;
  /** Impact prices for buy/sell */
  impactPxs: [string, string];
}

/**
 * Combined perps metadata with asset contexts
 */
export interface HyperliquidPerpsMetaAndAssetCtxs {
  /** Universe metadata */
  meta: HyperliquidPerpsMeta;
  /** Asset contexts keyed by coin name */
  assetCtxs: HyperliquidAssetContext[];
}
