/**
 * Helper for assembling the nested `PoolMetricsBlock` consumed by all four
 * pool API endpoints (search, favorites, lookup, discover).
 *
 * Combines subgraph metrics (from `UniswapV3SubgraphClient.getPoolsMetricsBatch`
 * or equivalently shaped data) with σ-filter results (from
 * `PoolSigmaFilterService.enrichPools`) into a single
 * `metrics: PoolMetricsBlock` shape.
 */

import type { PoolSigmaResult } from '@midcurve/services';
import type {
  PoolMetricsBlock,
  SigmaFilterBlock,
  SigmaResult,
  TokenVolatilityBlock,
  VolatilityBlock,
} from '@midcurve/api-shared';

/**
 * Inputs required to build a `PoolMetricsBlock` for a single pool.
 *
 * The subgraph half can come from either `getPoolsMetricsBatch()` (which has
 * the full field set) or from a manually-assembled equivalent.
 */
export interface PoolMetricsInput {
  tvlUSD: string;
  volume24hUSD: string;
  fees24hUSD: string;
  fees7dUSD: string;
  volume7dAvgUSD: string;
  fees7dAvgUSD: string;
  apr7d: number;
}

/**
 * Build a `PoolMetricsBlock` by merging subgraph metrics with the σ-filter
 * result for the pool.
 *
 * If `sigma` is undefined (e.g. enrichment was skipped), the σ-filter and
 * volatility blocks default to INSUFFICIENT_DATA / null shapes — the
 * response remains type-correct.
 */
export function buildPoolMetricsBlock(
  subgraph: PoolMetricsInput,
  sigma: PoolSigmaResult | undefined,
): PoolMetricsBlock {
  if (sigma) {
    return {
      tvlUSD: subgraph.tvlUSD,
      volume24hUSD: subgraph.volume24hUSD,
      fees24hUSD: subgraph.fees24hUSD,
      fees7dUSD: subgraph.fees7dUSD,
      volume7dAvgUSD: subgraph.volume7dAvgUSD,
      fees7dAvgUSD: subgraph.fees7dAvgUSD,
      apr7d: subgraph.apr7d,
      feeApr24h: sigma.feeApr24h,
      feeApr7dAvg: sigma.feeApr7dAvg,
      feeAprPrimary: sigma.feeAprPrimary,
      feeAprSource: sigma.feeAprSource,
      volatility: sigma.volatility,
      sigmaFilter: sigma.sigmaFilter,
    };
  }

  return {
    tvlUSD: subgraph.tvlUSD,
    volume24hUSD: subgraph.volume24hUSD,
    fees24hUSD: subgraph.fees24hUSD,
    fees7dUSD: subgraph.fees7dUSD,
    volume7dAvgUSD: subgraph.volume7dAvgUSD,
    fees7dAvgUSD: subgraph.fees7dAvgUSD,
    apr7d: subgraph.apr7d,
    feeApr24h: null,
    feeApr7dAvg: null,
    feeAprPrimary: null,
    feeAprSource: 'unavailable',
    volatility: emptyVolatilityBlock(),
    sigmaFilter: emptySigmaFilter(),
  };
}

function emptyTokenBlock(): TokenVolatilityBlock {
  const result: SigmaResult = { status: 'insufficient_history' };
  return {
    ref: '',
    sigma60d: result,
    sigma365d: result,
  };
}

function emptyVolatilityBlock(): VolatilityBlock {
  const result: SigmaResult = { status: 'insufficient_history' };
  return {
    token0: emptyTokenBlock(),
    token1: emptyTokenBlock(),
    pair: { sigma60d: result, sigma365d: result },
    velocity: null,
    pivotCurrency: 'usd',
    computedAt: new Date(0).toISOString(),
  };
}

function emptySigmaFilter(): SigmaFilterBlock {
  return {
    feeApr: null,
    sigmaSqOver8_365d: null,
    sigmaSqOver8_60d: null,
    marginLongTerm: null,
    marginShortTerm: null,
    verdictLongTerm: 'INSUFFICIENT_DATA',
    verdictShortTerm: 'INSUFFICIENT_DATA',
    verdictAgreement: 'INSUFFICIENT_DATA',
  };
}
