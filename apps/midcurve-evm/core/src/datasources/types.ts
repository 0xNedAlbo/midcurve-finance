import type { Hex } from 'viem';

/**
 * OHLC timeframe intervals supported by Hyperliquid
 */
export const HYPERLIQUID_INTERVALS = {
  ONE_MINUTE: '1m',
  THREE_MINUTES: '3m',
  FIVE_MINUTES: '5m',
  FIFTEEN_MINUTES: '15m',
  THIRTY_MINUTES: '30m',
  ONE_HOUR: '1h',
  TWO_HOURS: '2h',
  FOUR_HOURS: '4h',
  EIGHT_HOURS: '8h',
  TWELVE_HOURS: '12h',
  ONE_DAY: '1d',
  THREE_DAYS: '3d',
  ONE_WEEK: '1w',
  ONE_MONTH: '1M',
} as const;

export type HyperliquidInterval = (typeof HYPERLIQUID_INTERVALS)[keyof typeof HYPERLIQUID_INTERVALS];

/**
 * Map from our timeframe (minutes) to Hyperliquid interval string
 */
export const TIMEFRAME_TO_INTERVAL: Record<number, HyperliquidInterval> = {
  1: '1m',
  3: '3m',
  5: '5m',
  15: '15m',
  30: '30m',
  60: '1h',
  120: '2h',
  240: '4h',
  480: '8h',
  720: '12h',
  1440: '1d',
  4320: '3d',
  10080: '1w',
  43200: '1M',
};

/**
 * Map from Hyperliquid interval to our timeframe (minutes)
 */
export const INTERVAL_TO_TIMEFRAME: Record<HyperliquidInterval, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '3d': 4320,
  '1w': 10080,
  '1M': 43200,
};

/**
 * Configuration for HyperliquidFeed
 */
export interface HyperliquidFeedConfig {
  /** Use testnet instead of mainnet */
  testnet?: boolean;

  /** Maximum WebSocket reconnection attempts */
  maxReconnectAttempts?: number;
}

/**
 * Subscription key for tracking active subscriptions
 */
export interface CandleSubscriptionKey {
  symbol: string;
  interval: HyperliquidInterval;
}

/**
 * Internal representation of a Hyperliquid candle
 */
export interface HyperliquidCandle {
  /** Start timestamp (ms) */
  t: number;
  /** End timestamp (ms) */
  T: number;
  /** Symbol */
  s: string;
  /** Interval */
  i: string;
  /** Open price */
  o: number;
  /** Close price */
  c: number;
  /** High price */
  h: number;
  /** Low price */
  l: number;
  /** Volume */
  v: number;
  /** Number of trades */
  n: number;
}

/**
 * Generate a market ID from symbol
 * Uses keccak256 hash of "symbol/USD"
 */
export function generateMarketId(symbol: string): Hex {
  // For now, use a simple encoding. In production, this should use keccak256
  const normalizedSymbol = symbol.toUpperCase();
  // Pad to 32 bytes
  const hex = Buffer.from(normalizedSymbol + '/USD').toString('hex').padEnd(64, '0');
  return `0x${hex}` as Hex;
}
