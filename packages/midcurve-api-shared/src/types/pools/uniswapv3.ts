/**
 * Type definitions for Uniswap V3 Pool Lookup Endpoint
 *
 * GET /api/pools/uniswapv3/:chainId/:address
 */

import { z } from 'zod';
import type { UniswapV3Pool } from '@midcurve/shared';

/**
 * Path parameters for pool lookup
 */
export interface GetUniswapV3PoolParams {
  /**
   * EVM chain ID where the pool is deployed
   * @example "1" (Ethereum), "42161" (Arbitrum), "8453" (Base)
   */
  chainId: string;

  /**
   * Pool contract address (EIP-55 checksummed or lowercase)
   * @example "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
   */
  address: string;
}

/**
 * Query parameters for pool lookup
 */
export interface GetUniswapV3PoolQuery {
  /**
   * Whether to enrich response with subgraph metrics (TVL, volume, fees)
   * Defaults to false if not provided
   * @example true
   */
  metrics?: boolean;

  /**
   * Whether to enrich response with fee data for APR calculations
   * Defaults to false if not provided
   * @example true
   */
  fees?: boolean;
}

/**
 * Response data for pool lookup
 *
 * Includes pool with fresh on-chain state and optional subgraph metrics
 */
export interface GetUniswapV3PoolData {
  /**
   * Pool data with fresh on-chain state
   * State (price, liquidity, tick) is always current
   */
  pool: UniswapV3Pool;

  /**
   * Optional subgraph metrics (only included if enrichMetrics=true)
   * Includes 24-hour TVL, volume, and fees data
   */
  metrics?: {
    /**
     * Total Value Locked in USD
     * @example "1234567.89"
     */
    tvlUSD: string;

    /**
     * 24-hour trading volume in USD
     * @example "567890.12"
     */
    volumeUSD: string;

    /**
     * 24-hour fees collected in USD
     * @example "1234.56"
     */
    feesUSD: string;
  };

  /**
   * Optional fee data for APR calculations (only included if fees=true)
   * Includes 24-hour trading volumes, token prices, and pool liquidity
   */
  feeData?: {
    /**
     * Token0 24-hour volume in token units (BigInt as string)
     * @example "12345678901234"
     */
    token0DailyVolume: string;

    /**
     * Token1 24-hour volume in token units (BigInt as string)
     * @example "123456789012345678"
     */
    token1DailyVolume: string;

    /**
     * Token0 price in token1 terms (BigInt as string, scaled by token1 decimals)
     * @example "4016123456"
     */
    token0Price: string;

    /**
     * Token1 price in token0 terms (BigInt as string, scaled by token0 decimals)
     * @example "248901234567890"
     */
    token1Price: string;

    /**
     * Current pool liquidity (BigInt as string)
     * @example "5234567890123456789"
     */
    poolLiquidity: string;

    /**
     * Timestamp when fee data was calculated
     * @example "2025-10-21T14:30:00.000Z"
     */
    calculatedAt: string;
  };
}

/**
 * Schema for path parameters
 *
 * Validates chainId (positive integer) and pool contract address format (0x followed by 40 hex characters)
 */
export const GetUniswapV3PoolParamsSchema = z.object({
  chainId: z
    .string()
    .min(1, 'chainId is required')
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('chainId must be an integer')
        .positive('chainId must be positive'),
    ),

  address: z
    .string()
    .min(1, 'Pool address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address format'),
});

/**
 * Schema for query parameters
 *
 * Validates optional metrics flag and optional fees flag
 */
export const GetUniswapV3PoolQuerySchema = z.object({
  metrics: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true')
    .pipe(z.boolean()),

  fees: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true')
    .pipe(z.boolean()),
});
