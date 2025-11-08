/**
 * Pool Price Fetching Utilities for UniswapV3 Position Ledger
 *
 * Provides functions for discovering and fetching historic pool prices.
 */

import type { Logger } from 'pino';
import type { UniswapV3PoolPrice } from '@midcurve/shared';
import type { UniswapV3PoolPriceService } from '../../../pool-price/uniswapv3-pool-price-service.js';

/**
 * Historic pool price data.
 */
export interface HistoricPoolPrice {
  /** The pool price record from database (or newly discovered) */
  poolPrice: UniswapV3PoolPrice;
  /** Square root price X96 extracted from state */
  sqrtPriceX96: bigint;
  /** Timestamp of the price snapshot */
  timestamp: Date;
}

/**
 * Discovers or fetches historic pool price at a specific block.
 *
 * This function:
 * 1. Calls the pool price service to discover the price at the given block
 * 2. Extracts sqrtPriceX96 from the price state
 * 3. Returns structured price data for event processing
 *
 * The pool price service handles:
 * - Checking if price already exists in database
 * - Fetching from blockchain if needed
 * - Caching the result
 *
 * @param poolId - Pool ID to get price for
 * @param blockNumber - Block number for historic price
 * @param poolPriceService - Pool price service instance
 * @param logger - Structured logger
 * @returns Historic pool price data
 *
 * @example
 * ```typescript
 * const priceData = await getHistoricPoolPrice(
 *   'pool_eth_usdc_500',
 *   12345678n,
 *   poolPriceService,
 *   logger
 * );
 * console.log(priceData.sqrtPriceX96); // 79228162514264337593543950336n
 * console.log(priceData.timestamp); // 2024-01-01T00:00:00Z
 * ```
 */
export async function getHistoricPoolPrice(
  poolId: string,
  blockNumber: bigint,
  poolPriceService: UniswapV3PoolPriceService,
  logger: Logger
): Promise<HistoricPoolPrice> {
  logger.debug(
    { poolId, blockNumber: blockNumber.toString() },
    'Discovering historic pool price'
  );

  const poolPrice = await poolPriceService.discover(poolId, {
    blockNumber: Number(blockNumber),
  });

  const sqrtPriceX96 = poolPrice.state.sqrtPriceX96;

  logger.debug(
    {
      poolId,
      blockNumber: blockNumber.toString(),
      sqrtPriceX96: sqrtPriceX96.toString(),
      timestamp: poolPrice.timestamp,
    },
    'Historic pool price discovered'
  );

  return {
    poolPrice,
    sqrtPriceX96,
    timestamp: poolPrice.timestamp,
  };
}
