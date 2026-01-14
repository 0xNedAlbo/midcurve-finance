/**
 * RabbitMQ Message Types
 *
 * Defines the message structures for automation events.
 */

import type { UniswapV3OhlcCandle } from '../types/ohlc-uniswapv3';

/**
 * Order trigger message - published when price condition is met
 */
export interface OrderTriggerMessage {
  /** Order ID from database */
  orderId: string;
  /** Position ID being closed */
  positionId: string;
  /** Pool address where trigger occurred */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current sqrtPriceX96 at trigger time */
  currentPrice: string;
  /** Trigger price boundary that was crossed */
  triggerPrice: string;
  /** Whether this was a lower or upper trigger */
  triggerSide: 'lower' | 'upper';
  /** Timestamp of trigger detection */
  triggeredAt: string;
}

/**
 * Uniswap V3 OHLC candle message - published on minute boundaries
 *
 * Contains 1-minute OHLC data with volume for both tokens.
 * Prices are sqrtPriceX96 values (as strings for JSON serialization).
 */
export type UniswapV3OhlcCandleMessage = UniswapV3OhlcCandle;

/**
 * Serialize a message for publishing
 */
export function serializeMessage<T>(message: T): Buffer {
  return Buffer.from(JSON.stringify(message));
}

/**
 * Deserialize a message from consumption
 */
export function deserializeMessage<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString()) as T;
}
