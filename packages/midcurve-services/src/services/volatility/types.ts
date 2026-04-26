/**
 * Internal types for the volatility services.
 *
 * Public response types live in `@midcurve/api-shared/types/pools/sigma-filter`
 * and are re-exported here for convenience to keep service-internal imports
 * consolidated.
 */

import type {
  PairVolatilityBlock,
  SigmaFilterBlock,
  SigmaResult,
  SigmaStatus,
  SigmaVerdict,
  TokenVolatilityBlock,
  VerdictAgreement,
  VolatilityBlock,
} from '@midcurve/api-shared';

export type {
  PairVolatilityBlock,
  SigmaFilterBlock,
  SigmaResult,
  SigmaStatus,
  SigmaVerdict,
  TokenVolatilityBlock,
  VerdictAgreement,
  VolatilityBlock,
};

/**
 * Daily price series — the canonical shape produced by
 * `TokenPriceSeriesService` and consumed by `volatility-math` /
 * `VolatilityService`.
 */
export interface DailyPriceSeries {
  /** Token reference, e.g. `coingecko/usd-coin`. */
  ref: string;
  /** Pivot currency. v1: always `'usd'`. */
  pivotCurrency: 'usd';
  /** Status of the series. `closes` is present iff `'ok'`. */
  status: SigmaStatus;
  /** Daily observations sorted ascending by ISO date. */
  closes?: ReadonlyArray<{ date: string; price: number }>;
  /** ISO timestamp at which the series was fetched / cached. */
  fetchedAt: string;
}

/**
 * Per-token σ result the `VolatilityService` returns for a single token.
 */
export interface TokenVolatility {
  ref: string;
  status: SigmaStatus;
  sigma60d: SigmaResult;
  sigma365d: SigmaResult;
}

/**
 * Platform-agnostic descriptor consumed by `PoolSigmaFilterService.enrichPools`.
 *
 * Identity uses the project's `tokenHash` convention (`{type}/{chainId}/{address}`),
 * so any 2-token pool — UniswapV3, Orca, Aerodrome — fits.
 */
export interface PoolSigmaDescriptor {
  /** Pool hash, e.g. `uniswapv3/8453/0xd0b53...`. Used as result key. */
  poolHash: string;
  /** Token0 hash, e.g. `erc20/8453/0x4200000000000000000000000000000000000006`. */
  token0Hash: string;
  /** Token1 hash, e.g. `erc20/8453/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. */
  token1Hash: string;
  /** Pool TVL in USD as a decimal string (subgraph format). */
  tvlUSD: string;
  /** Last-complete-day fees in USD as a decimal string. */
  fees24hUSD: string;
  /** 7-day-average daily fees in USD as a decimal string. */
  fees7dAvgUSD: string;
}

/**
 * Per-pool σ-filter result returned by `PoolSigmaFilterService.enrichPools`.
 */
export interface PoolSigmaResult {
  poolHash: string;
  feeApr24h: number | null;
  feeApr7dAvg: number | null;
  feeAprPrimary: number | null;
  feeAprSource: '24h' | '7d_avg' | 'unavailable';
  volatility: VolatilityBlock;
  sigmaFilter: SigmaFilterBlock;
}
