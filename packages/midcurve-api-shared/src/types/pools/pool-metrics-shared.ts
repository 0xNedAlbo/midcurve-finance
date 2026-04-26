/**
 * Shared Pool Metrics Block
 *
 * Single source of truth for the nested `metrics` shape consumed by all four
 * pool-data endpoints (`search`, `favorites`, `lookup`, `discover`). Same
 * shape across platforms — UniswapV3 today, Orca/Aerodrome/etc. in the future.
 *
 * See PRD-pool-sigma-filter.md §3 for the full schema.
 */

import type {
  FeeAprSource,
  SigmaFilterBlock,
  VolatilityBlock,
} from './sigma-filter.js';

/**
 * Nested `metrics` block on pool API responses.
 *
 * **Existing fields** (PRD §3.1) are decimal strings sourced from the
 * subgraph; `apr7d` is the historical 7-day APR as a percentage (e.g. 25.12
 * means 25.12%) for backwards compatibility.
 *
 * **New fee-APR fields** (PRD §3.2) are raw rates (e.g. 0.2512 means 25.12%).
 * Unit divergence is intentional and documented per-field — do not "fix" it.
 */
export interface PoolMetricsBlock {
  // -------------------- Existing subgraph metrics (PRD §3.1) --------------------

  /** Total Value Locked in USD (decimal string). */
  tvlUSD: string;

  /**
   * Most recent 24h trading volume in USD (last complete UTC day; the
   * in-progress current UTC day is excluded).
   */
  volume24hUSD: string;

  /**
   * Most recent 24h fees collected in USD (last complete UTC day; the
   * in-progress current UTC day is excluded).
   */
  fees24hUSD: string;

  /** Sum of fees from last 7 complete UTC days in USD. */
  fees7dUSD: string;

  /**
   * Average daily trading volume in USD across the last 7 complete UTC days.
   * Excludes today's partial day. Falls back to fewer days for young pools.
   */
  volume7dAvgUSD: string;

  /**
   * Average daily fees collected in USD across the last 7 complete UTC days.
   * Excludes today's partial day. Falls back to fewer days for young pools.
   */
  fees7dAvgUSD: string;

  /**
   * 7-day average APR — calculated as `(avgDailyFees * 365 / tvl) * 100`.
   *
   * **Unit:** percentage (e.g. 25.12 means 25.12%). Kept for backwards
   * compatibility. For the raw-rate equivalent, use `feeApr7dAvg`.
   */
  apr7d: number;

  // -------------------- Fee-APR (PRD §3.2) --------------------

  /**
   * Fee-APR from the most recent 24h fees: `fees24hUSD * 365 / tvlUSD`.
   *
   * **Unit:** raw rate (e.g. 0.0422 means 4.22%). `null` when `tvlUSD` is
   * missing or zero.
   */
  feeApr24h: number | null;

  /**
   * Fee-APR from the 7-day average fees: `fees7dAvgUSD * 365 / tvlUSD`.
   *
   * **Unit:** raw rate. `null` when `tvlUSD` is missing or zero.
   * This is the canonical input to `sigmaFilter.feeApr` (PRD §3.4).
   */
  feeApr7dAvg: number | null;

  /**
   * Primary fee-APR consumed by the verdict — currently `feeApr7dAvg`.
   *
   * **Unit:** raw rate. `null` when unavailable.
   */
  feeAprPrimary: number | null;

  /** Source window for `feeAprPrimary`. */
  feeAprSource: FeeAprSource;

  // -------------------- Volatility & verdict (PRD §3.3, §3.4) --------------------

  /** Per-token σ vs USD plus synthetic cross-pair σ. */
  volatility: VolatilityBlock;

  /** σ-filter verdict: `feeApr` vs `σ²/8` at both windows. */
  sigmaFilter: SigmaFilterBlock;
}
