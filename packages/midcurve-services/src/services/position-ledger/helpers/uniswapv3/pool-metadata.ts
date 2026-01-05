/**
 * Pool Metadata Fetching Utilities for UniswapV3 Position Ledger
 *
 * Provides functions for fetching pool and token metadata from the database.
 */

import type { PrismaClient } from '@midcurve/database';
import type { Logger } from 'pino';
import type { UniswapV3Pool, Erc20Token } from '@midcurve/shared';
import { log } from '../../../../logging/index.js';

/**
 * Pool metadata result containing pool, tokens, and quote token designation.
 */
export interface PoolMetadata {
  /** The pool record from database */
  pool: UniswapV3Pool;
  /** Token0 of the pool */
  token0: Erc20Token;
  /** Token1 of the pool */
  token1: Erc20Token;
  /** True if token0 is the quote token, false if token1 is quote */
  token0IsQuote: boolean;
  /** Decimal places for token0 */
  token0Decimals: number;
  /** Decimal places for token1 */
  token1Decimals: number;
}

/**
 * Fetches pool metadata with tokens from database.
 *
 * This function:
 * 1. Queries the pool by ID (with token0 and token1 included)
 * 2. Validates the pool exists
 * 3. Validates both tokens are present
 * 4. Uses the provided quote token designation from the position
 *
 * @param poolId - Pool ID to fetch
 * @param isToken0Quote - Whether token0 is the quote token (from position's user preference)
 * @param prisma - Prisma client instance
 * @param logger - Structured logger
 * @returns Pool metadata with tokens and decimals
 * @throws Error if pool not found or tokens missing
 *
 * @example
 * ```typescript
 * const metadata = await fetchPoolWithTokens(
 *   'pool_eth_usdc_500',
 *   false, // token1 (USDC) is quote
 *   prisma,
 *   logger
 * );
 * console.log(metadata.pool.fee); // 500n (0.05%)
 * console.log(metadata.token0.symbol); // 'WETH'
 * console.log(metadata.token1.symbol); // 'USDC'
 * console.log(metadata.token0IsQuote); // false (USDC is quote)
 * ```
 */
export async function fetchPoolWithTokens(
  poolId: string,
  isToken0Quote: boolean,
  prisma: PrismaClient,
  logger: Logger
): Promise<PoolMetadata> {
  log.dbOperation(logger, 'findUnique', 'Pool', { id: poolId });

  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    include: {
      token0: true,
      token1: true,
    },
  });

  if (!pool) {
    throw new Error(`Pool not found: ${poolId}`);
  }

  if (!pool.token0 || !pool.token1) {
    throw new Error(`Pool tokens not found for pool: ${poolId}`);
  }

  return {
    pool: pool as unknown as UniswapV3Pool,
    token0: pool.token0 as unknown as Erc20Token,
    token1: pool.token1 as unknown as Erc20Token,
    token0IsQuote: isToken0Quote,
    token0Decimals: pool.token0.decimals,
    token1Decimals: pool.token1.decimals,
  };
}
