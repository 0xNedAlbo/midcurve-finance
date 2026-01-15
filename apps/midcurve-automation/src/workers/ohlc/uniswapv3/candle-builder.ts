/**
 * Uniswap V3 OHLC Candle Builder
 *
 * Pure functions for building and managing OHLC candles from Uniswap V3 swap events.
 * All functions are side-effect free for testability.
 */

import { getMinuteBoundary } from '../../../types/ohlc';
import type {
  UniswapV3OhlcCandle,
  UniswapV3OhlcCandleBuilder,
  UniswapV3SwapEventData,
} from '../../../types/ohlc-uniswapv3';

// Re-export for convenience
export { getMinuteBoundary } from '../../../types/ohlc';

/**
 * Helper: absolute value for bigint
 */
function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Create a new candle builder for a Uniswap V3 pool
 *
 * @param chainId - EVM chain ID
 * @param poolAddress - Pool contract address
 * @param initialPrice - Initial sqrtPriceX96 value
 * @param timestampMs - Current timestamp (defaults to Date.now())
 * @returns New candle builder
 */
export function createCandleBuilder(
  chainId: number,
  poolAddress: string,
  initialPrice: bigint,
  timestampMs: number = Date.now()
): UniswapV3OhlcCandleBuilder {
  const minuteMs = getMinuteBoundary(timestampMs);

  return {
    chainId,
    poolAddress,
    currentMinuteMs: minuteMs,
    open: initialPrice,
    high: initialPrice,
    low: initialPrice,
    close: initialPrice,
    volume0: 0n,
    volume1: 0n,
    swapCount: 0,
    hasData: false,
  };
}

/**
 * Result of processing a swap event
 */
export interface ProcessSwapResult {
  /** Updated candle builder */
  builder: UniswapV3OhlcCandleBuilder;
  /** Completed candle (if minute boundary crossed), null otherwise */
  completedCandle: UniswapV3OhlcCandle | null;
}

/**
 * Process a swap event and update the candle builder
 *
 * If the event crosses a minute boundary:
 * 1. Finalizes the current candle
 * 2. Creates a new candle with continuity (open = previous close)
 * 3. Updates the new candle with the event data
 *
 * @param builder - Current candle builder
 * @param event - Swap event data
 * @param eventTimestampMs - Timestamp of the event (usually Date.now())
 * @returns Updated builder and completed candle (if boundary crossed)
 */
export function processSwapEvent(
  builder: UniswapV3OhlcCandleBuilder,
  event: UniswapV3SwapEventData,
  eventTimestampMs: number
): ProcessSwapResult {
  const eventMinuteMs = getMinuteBoundary(eventTimestampMs);

  // Check if we've crossed into a new minute
  if (eventMinuteMs > builder.currentMinuteMs) {
    // Finalize current candle if we have data
    const completedCandle = builder.hasData ? finalizeCandle(builder) : null;

    // Start new candle with continuity (open = previous close)
    const newBuilder = createCandleBuilder(
      builder.chainId,
      builder.poolAddress,
      builder.close, // Continuity: new open = old close
      eventTimestampMs
    );

    // Recursively process this event with the new builder
    const result = processSwapEvent(newBuilder, event, eventTimestampMs);

    // Return the completed candle from the old minute
    return {
      builder: result.builder,
      completedCandle: completedCandle || result.completedCandle,
    };
  }

  // Update current candle with event data
  const price = event.sqrtPriceX96;

  const updatedBuilder: UniswapV3OhlcCandleBuilder = {
    ...builder,
    high: price > builder.high ? price : builder.high,
    low: price < builder.low ? price : builder.low,
    close: price,
    // Use absolute values for volume
    volume0: builder.volume0 + abs(event.amount0),
    volume1: builder.volume1 + abs(event.amount1),
    swapCount: builder.swapCount + 1,
    hasData: true,
  };

  return { builder: updatedBuilder, completedCandle: null };
}

/**
 * Finalize a candle builder into a publishable candle
 *
 * Converts BigInt values to strings for JSON serialization.
 *
 * @param builder - Candle builder to finalize
 * @returns Finalized OHLC candle
 */
export function finalizeCandle(builder: UniswapV3OhlcCandleBuilder): UniswapV3OhlcCandle {
  return {
    chainId: builder.chainId,
    poolAddress: builder.poolAddress,
    timeframe: '1m',
    timestampMs: builder.currentMinuteMs,
    timestamp: new Date(builder.currentMinuteMs).toISOString(),
    open: builder.open.toString(),
    high: builder.high.toString(),
    low: builder.low.toString(),
    close: builder.close.toString(),
    volume0: builder.volume0.toString(),
    volume1: builder.volume1.toString(),
    swapCount: builder.swapCount,
  };
}

/**
 * Start a new candle from a previous one (for timer-based rollover)
 *
 * Used when minute boundary timer fires and we need to start a new candle
 * even without a swap event.
 *
 * Maintains continuity: new open = previous close
 *
 * @param builder - Previous candle builder
 * @param newMinuteMs - New minute boundary timestamp
 * @returns New candle builder
 */
export function startNewCandle(
  builder: UniswapV3OhlcCandleBuilder,
  newMinuteMs: number
): UniswapV3OhlcCandleBuilder {
  return {
    chainId: builder.chainId,
    poolAddress: builder.poolAddress,
    currentMinuteMs: newMinuteMs,
    // Continuity: open = previous close
    open: builder.close,
    high: builder.close,
    low: builder.close,
    close: builder.close,
    // Reset volume and swap count
    volume0: 0n,
    volume1: 0n,
    swapCount: 0,
    hasData: false,
  };
}

/**
 * Check if a candle builder has any data (received at least one swap)
 */
export function hasData(builder: UniswapV3OhlcCandleBuilder): boolean {
  return builder.hasData;
}

/**
 * Check if a candle builder is for a stale minute (behind the current time)
 *
 * @param builder - Candle builder
 * @param currentTimestampMs - Current timestamp (defaults to Date.now())
 * @returns true if the builder's minute is in the past
 */
export function isStaleMinute(
  builder: UniswapV3OhlcCandleBuilder,
  currentTimestampMs: number = Date.now()
): boolean {
  const currentMinuteMs = getMinuteBoundary(currentTimestampMs);
  return builder.currentMinuteMs < currentMinuteMs;
}
