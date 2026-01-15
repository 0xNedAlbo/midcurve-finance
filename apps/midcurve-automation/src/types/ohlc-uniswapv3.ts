/**
 * Uniswap V3 OHLC Types
 *
 * Protocol-specific types for Uniswap V3 OHLC data.
 * Extends base OHLC types with Uniswap V3-specific fields.
 */

import type { OhlcCandle, OhlcCandleBuilder, OhlcPoolSubscription } from './ohlc';

/**
 * Uniswap V3 Swap event data
 *
 * Parsed from the Swap event emitted by Uniswap V3 pools.
 * https://docs.uniswap.org/contracts/v3/reference/core/interfaces/pool/IUniswapV3PoolEvents
 */
export interface UniswapV3SwapEventData {
  /** Address that initiated the swap */
  sender: string;

  /** Address that received the output tokens */
  recipient: string;

  /** Delta of token0 (positive = token0 in, negative = token0 out) */
  amount0: bigint;

  /** Delta of token1 (positive = token1 in, negative = token1 out) */
  amount1: bigint;

  /** Pool price after the swap (sqrt(token1/token0) * 2^96) */
  sqrtPriceX96: bigint;

  /** Liquidity in the pool after the swap */
  liquidity: bigint;

  /** Tick after the swap */
  tick: number;

  /** Transaction hash of the swap */
  transactionHash: string;

  /** Block number where the swap occurred */
  blockNumber: bigint;
}

/**
 * Uniswap V3 OHLC candle with volume data
 *
 * Prices are sqrtPriceX96 values (as strings for JSON serialization).
 * UI is responsible for:
 * - Converting sqrtPriceX96 to human-readable price
 * - Inverting H↔L when isToken0Quote = true
 */
export interface UniswapV3OhlcCandle extends OhlcCandle {
  /** Absolute volume of token0 traded (as string) */
  volume0: string;

  /** Absolute volume of token1 traded (as string) */
  volume1: string;
}

/**
 * Uniswap V3 candle builder with volume accumulators
 */
export interface UniswapV3OhlcCandleBuilder extends OhlcCandleBuilder {
  /** Accumulated absolute volume of token0 */
  volume0: bigint;

  /** Accumulated absolute volume of token1 */
  volume1: bigint;
}

/**
 * Uniswap V3 pool subscription
 */
export type UniswapV3OhlcPoolSubscription = OhlcPoolSubscription<UniswapV3OhlcCandleBuilder>;

/**
 * Uniswap V3 Swap event ABI for viem
 */
export const UNISWAP_V3_SWAP_EVENT_ABI = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { indexed: true, name: 'sender', type: 'address' },
      { indexed: true, name: 'recipient', type: 'address' },
      { indexed: false, name: 'amount0', type: 'int256' },
      { indexed: false, name: 'amount1', type: 'int256' },
      { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
      { indexed: false, name: 'liquidity', type: 'uint128' },
      { indexed: false, name: 'tick', type: 'int24' },
    ],
  },
] as const;
