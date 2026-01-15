/**
 * OHLC (Open, High, Low, Close) Candle Data Types
 *
 * Protocol-agnostic base types for OHLC candlestick data.
 * Extended by protocol-specific types (e.g., ohlc-uniswapv3.ts).
 */

/**
 * Supported OHLC timeframes
 */
export type OhlcTimeframe = '1m';

/**
 * Base OHLC candle data structure (protocol-agnostic)
 *
 * All prices are stored as strings to preserve BigInt precision through JSON serialization.
 * Volume fields are protocol-specific and defined in extended types.
 */
export interface OhlcCandle {
  /** EVM chain ID */
  chainId: number;

  /** Pool/market contract address */
  poolAddress: string;

  /** Candle timeframe */
  timeframe: OhlcTimeframe;

  /** Minute boundary timestamp (Unix milliseconds) */
  timestampMs: number;

  /** ISO 8601 timestamp of minute start */
  timestamp: string;

  /** Opening price (first price of the period) */
  open: string;

  /** Highest price during the period */
  high: string;

  /** Lowest price during the period */
  low: string;

  /** Closing price (last price of the period) */
  close: string;

  /** Number of trades/swaps within this candle */
  swapCount: number;
}

/**
 * In-memory state for building a candle (protocol-agnostic base)
 *
 * Uses BigInt internally for efficient computation.
 * Converted to OhlcCandle (with string prices) when finalized.
 */
export interface OhlcCandleBuilder {
  /** EVM chain ID */
  chainId: number;

  /** Pool/market contract address */
  poolAddress: string;

  /** Current minute boundary (Unix milliseconds) */
  currentMinuteMs: number;

  /** Opening price */
  open: bigint;

  /** Highest price seen */
  high: bigint;

  /** Lowest price seen */
  low: bigint;

  /** Current/closing price */
  close: bigint;

  /** Number of swaps processed */
  swapCount: number;

  /** Whether at least one swap has been processed this minute */
  hasData: boolean;
}

/**
 * Pool subscription state for OHLC tracking
 */
export interface OhlcPoolSubscription<TBuilder extends OhlcCandleBuilder = OhlcCandleBuilder> {
  /** EVM chain ID */
  chainId: number;

  /** Pool contract address */
  poolAddress: string;

  /** Function to stop the WebSocket subscription */
  unwatch: () => void;

  /** Current candle builder state */
  candleBuilder: TBuilder;
}

/**
 * Pool identifier key
 */
export interface OhlcPoolKey {
  chainId: number;
  poolAddress: string;
}

/**
 * Generate a unique key for a pool subscription
 */
export function getPoolKey(chainId: number, poolAddress: string): string {
  return `${chainId}-${poolAddress.toLowerCase()}`;
}

/**
 * Get the minute boundary timestamp for a given time
 * (floors to the start of the minute)
 */
export function getMinuteBoundary(timestampMs: number): number {
  return Math.floor(timestampMs / 60000) * 60000;
}
