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
 * Range change notification message - published when position goes in/out of range
 */
export interface RangeChangeNotificationMessage {
  /** User ID to notify */
  userId: string;
  /** Position ID */
  positionId: string;
  /** Pool ID */
  poolId: string;
  /** Pool address */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Event type */
  eventType: 'POSITION_OUT_OF_RANGE' | 'POSITION_IN_RANGE';
  /** Current tick */
  currentTick: number;
  /** Current sqrtPriceX96 */
  currentSqrtPriceX96: string;
  /** Position tick lower */
  tickLower: number;
  /** Position tick upper */
  tickUpper: number;
  /** Timestamp of detection */
  detectedAt: string;
}

/**
 * Execution result notification message - published when order execution completes
 */
export interface ExecutionResultNotificationMessage {
  /** User ID to notify */
  userId: string;
  /** Position ID */
  positionId: string;
  /** Order ID */
  orderId: string;
  /** Event type */
  eventType:
    | 'STOP_LOSS_EXECUTED'
    | 'STOP_LOSS_FAILED'
    | 'TAKE_PROFIT_EXECUTED'
    | 'TAKE_PROFIT_FAILED';
  /** Chain ID */
  chainId: number;
  /** For success: transaction hash */
  txHash?: string;
  /** For success: amount of token0 received */
  amount0Out?: string;
  /** For success: amount of token1 received */
  amount1Out?: string;
  /** Trigger side (lower = stop loss, upper = take profit) */
  triggerSide: 'lower' | 'upper';
  /** Trigger sqrtPriceX96 */
  triggerSqrtPriceX96: string;
  /** For success: execution sqrtPriceX96 */
  executionSqrtPriceX96?: string;
  /** For failure: error message */
  error?: string;
  /** For failure: retry count */
  retryCount?: number;
  /** Timestamp */
  timestamp: string;
}

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
