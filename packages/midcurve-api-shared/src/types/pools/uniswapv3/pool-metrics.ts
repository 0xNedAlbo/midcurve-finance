/**
 * Pool Metrics API Types
 *
 * Types for fetching real-time pool fee and volume data from subgraph.
 * Used for APR calculations and pool analytics.
 *
 * GET /api/pools/uniswapv3/:chainId/:poolAddress/metrics
 */

import type { ApiResponse } from '../../common/api-response.js';
import type {
  FeeAprSource,
  SigmaFilterBlock,
  VolatilityBlock,
} from '../sigma-filter.js';

/**
 * Request parameters for getting pool metrics (from URL path)
 */
export interface GetPoolMetricsRequest {
  /**
   * Chain ID where pool exists (path parameter)
   * @example "1" (Ethereum), "42161" (Arbitrum)
   */
  chainId: string;

  /**
   * Pool contract address (EIP-55 checksummed) (path parameter)
   * @example "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8"
   */
  poolAddress: string;
}

/**
 * Pool metrics data from subgraph
 *
 * Contains real-time TVL, volume, and fee data for APR calculations.
 * All BigInt values are serialized as strings.
 */
export interface PoolMetricsData {
  /**
   * Chain ID where pool exists
   */
  chainId: number;

  /**
   * Pool contract address (EIP-55 checksummed)
   */
  poolAddress: string;

  /**
   * Total Value Locked in USD
   * @example "234567890.75"
   */
  tvlUSD: string;

  /**
   * 24-hour trading volume in USD (last complete UTC day; the in-progress
   * current UTC day is excluded to avoid partial-day under-reporting)
   * @example "23456789.12"
   */
  volumeUSD: string;

  /**
   * 24-hour fees collected in USD (last complete UTC day; the in-progress
   * current UTC day is excluded to avoid partial-day under-reporting)
   * @example "2345.67"
   */
  feesUSD: string;

  /**
   * Average daily trading volume in USD across the last 7 complete UTC days.
   * Excludes today's partial day. Falls back to fewer days for young pools.
   * @example "21234567.89"
   */
  volume7dAvgUSD: string;

  /**
   * Average daily fees collected in USD across the last 7 complete UTC days.
   * Excludes today's partial day. Falls back to fewer days for young pools.
   * @example "2123.45"
   */
  fees7dAvgUSD: string;

  /**
   * 24-hour volume for token0 (in token0's native decimals)
   * BigInt as string
   * @example "1234567890000000000000" // ~1234.567 tokens with 18 decimals
   */
  volumeToken0: string;

  /**
   * 24-hour volume for token1 (in token1's native decimals)
   * BigInt as string
   * @example "4567890000000" // ~4567.890 tokens with 6 decimals
   */
  volumeToken1: string;

  /**
   * Price of token0 in token1 terms
   * BigInt as string scaled by token1 decimals
   * @example "4000000000" // 4000 USDC per 1 WETH (6 decimals)
   */
  token0Price: string;

  /**
   * Price of token1 in token0 terms
   * BigInt as string scaled by token0 decimals
   * @example "250000000000000" // 0.00025 WETH per 1 USDC (18 decimals)
   */
  token1Price: string;

  /**
   * Timestamp when metrics were calculated
   */
  calculatedAt: Date;

  // -------------------- σ-filter additions (PRD §3.2–§3.4) --------------------

  /**
   * Fee-APR from the most recent 24h fees: `fees24hUSD * 365 / tvlUSD`.
   * **Unit:** raw rate. `null` when `tvlUSD` is missing or zero.
   *
   * Note: this endpoint exposes `volumeUSD`/`feesUSD` (no `24h` infix) for
   * legacy reasons; the field below is the same as
   * `feesUSD * 365 / tvlUSD`.
   */
  feeApr24h: number | null;

  /**
   * Fee-APR from the 7-day average fees: `fees7dAvgUSD * 365 / tvlUSD`.
   * **Unit:** raw rate. `null` when `tvlUSD` is missing or zero.
   */
  feeApr7dAvg: number | null;

  /**
   * Primary fee-APR consumed by the verdict — currently `feeApr7dAvg`.
   * **Unit:** raw rate. `null` when unavailable.
   */
  feeAprPrimary: number | null;

  /** Source window for `feeAprPrimary`. */
  feeAprSource: FeeAprSource;

  /** Per-token σ vs USD plus synthetic cross-pair σ (PRD §3.3). */
  volatility: VolatilityBlock;

  /** σ-filter verdict: `feeApr` vs `σ²/8` at both windows (PRD §3.4). */
  sigmaFilter: SigmaFilterBlock;
}

/**
 * API response for pool metrics
 */
export type GetPoolMetricsResponse = ApiResponse<PoolMetricsData>;
