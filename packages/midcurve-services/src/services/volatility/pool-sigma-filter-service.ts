/**
 * PoolSigmaFilterService
 *
 * Pool-level enrichment that produces the `sigmaFilter` and `volatility`
 * blocks for the `metrics` section of pool API responses.
 *
 * Platform-agnostic: takes a `PoolSigmaDescriptor[]` (any 2-token pool
 * reduces to that shape). Implements the token-dedup batching of PRD §6.3 —
 * unique tokens are resolved and series-fetched once across the whole batch.
 *
 * Token resolution is DB-only via `CoingeckoTokenService.findByChainAndAddress`
 * — when a token is not in the table, the leg is reported as
 * `token_not_listed` and no CoinGecko call is made.
 *
 * v1 supports `erc20/{chainId}/{address}` tokenHashes only.
 */

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CoingeckoTokenService } from '../coingecko-token/index.js';
import { TokenPriceSeriesService } from './token-price-series-service.js';
import { VolatilityService } from './volatility-service.js';
import type {
  DailyPriceSeries,
  PairVolatilityBlock,
  PoolSigmaDescriptor,
  PoolSigmaResult,
  SigmaFilterBlock,
  SigmaResult,
  SigmaStatus,
  SigmaVerdict,
  TokenVolatility,
  TokenVolatilityBlock,
  VolatilityBlock,
} from './types.js';
import {
  alignDailySeries,
  cascadeStatus,
  feeAprFromTvlAndFees,
  pairSigmaForWindow,
  sigmaVerdict,
  verdictAgreement,
  type DailyPriceObservation,
} from './volatility-math.js';

const WINDOW_60D = 60;
const WINDOW_365D = 365;

export interface PoolSigmaFilterServiceDependencies {
  tokenPriceSeriesService?: TokenPriceSeriesService;
  volatilityService?: VolatilityService;
  coingeckoTokenService?: CoingeckoTokenService;
}

export class PoolSigmaFilterService {
  private static instance: PoolSigmaFilterService | null = null;

  private readonly tokenPriceSeriesService: TokenPriceSeriesService;
  private readonly volatilityService: VolatilityService;
  private readonly coingeckoTokenService: CoingeckoTokenService;
  private readonly logger: ServiceLogger;

  constructor(deps: PoolSigmaFilterServiceDependencies = {}) {
    this.tokenPriceSeriesService =
      deps.tokenPriceSeriesService ?? TokenPriceSeriesService.getInstance();
    this.volatilityService =
      deps.volatilityService ?? VolatilityService.getInstance();
    this.coingeckoTokenService =
      deps.coingeckoTokenService ?? new CoingeckoTokenService();
    this.logger = createServiceLogger('PoolSigmaFilterService');
  }

  static getInstance(): PoolSigmaFilterService {
    if (!PoolSigmaFilterService.instance) {
      PoolSigmaFilterService.instance = new PoolSigmaFilterService();
    }
    return PoolSigmaFilterService.instance;
  }

  static resetInstance(): void {
    PoolSigmaFilterService.instance = null;
  }

  /**
   * Compute fee-APR + per-leg σ + cross-pair σ + verdict for each descriptor.
   *
   * Returns a map keyed by `poolHash`. Callers are expected to merge the
   * result into their response shape.
   */
  async enrichPools(
    descriptors: ReadonlyArray<PoolSigmaDescriptor>,
  ): Promise<Map<string, PoolSigmaResult>> {
    log.methodEntry(this.logger, 'enrichPools', {
      poolCount: descriptors.length,
    });

    const computedAt = new Date().toISOString();

    // 1. Collect unique tokenHashes
    const uniqueTokenHashes = new Set<string>();
    for (const d of descriptors) {
      uniqueTokenHashes.add(d.token0Hash);
      uniqueTokenHashes.add(d.token1Hash);
    }

    // 2. Resolve coingeckoId for each unique tokenHash (DB-only, no CG fallback)
    const coingeckoIdByHash = await this.resolveTokenHashes([
      ...uniqueTokenHashes,
    ]);

    // 3. Fetch daily series for each resolved token (parallel, dedup’d)
    const seriesByGeckoId = await this.fetchSeriesForUnique(coingeckoIdByHash);

    // 4. Per-pool: assemble token-vol blocks, compute pair σ, build SigmaFilterBlock
    const result = new Map<string, PoolSigmaResult>();
    for (const d of descriptors) {
      result.set(d.poolHash, this.buildPoolResult(d, coingeckoIdByHash, seriesByGeckoId, computedAt));
    }

    log.methodExit(this.logger, 'enrichPools', {
      poolCount: descriptors.length,
      uniqueTokens: uniqueTokenHashes.size,
      resolvedTokens: [...coingeckoIdByHash.values()].filter(Boolean).length,
    });

    return result;
  }

  // -------------------- internals --------------------

  /**
   * Parse tokenHash → resolve via CoingeckoTokenService (DB-only).
   * Returns a map: tokenHash → coingeckoId | null (null = token_not_listed).
   */
  private async resolveTokenHashes(
    tokenHashes: string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();

    await Promise.all(
      tokenHashes.map(async (hash) => {
        const parsed = parseTokenHash(hash);
        if (!parsed) {
          // unknown tokenHash format → treated as not listed
          out.set(hash, null);
          return;
        }
        const token = await this.coingeckoTokenService.findByChainAndAddress(
          parsed.chainId,
          parsed.address,
        );
        out.set(hash, token?.coingeckoId ?? null);
      }),
    );

    return out;
  }

  /**
   * Parallel fetch of daily series for unique coingeckoIds. Returns a map
   * coingeckoId → DailyPriceSeries.
   */
  private async fetchSeriesForUnique(
    coingeckoIdByHash: ReadonlyMap<string, string | null>,
  ): Promise<Map<string, DailyPriceSeries>> {
    const uniqueIds = new Set<string>();
    for (const id of coingeckoIdByHash.values()) {
      if (id) uniqueIds.add(id);
    }

    const entries = await Promise.all(
      [...uniqueIds].map(
        async (id) =>
          [id, await this.tokenPriceSeriesService.getDailySeries(id)] as const,
      ),
    );

    return new Map(entries);
  }

  /**
   * Build the per-pool result by assembling token-vol blocks and the σ-filter.
   */
  private buildPoolResult(
    d: PoolSigmaDescriptor,
    coingeckoIdByHash: ReadonlyMap<string, string | null>,
    seriesByGeckoId: ReadonlyMap<string, DailyPriceSeries>,
    computedAt: string,
  ): PoolSigmaResult {
    const token0 = this.buildTokenBlock(d.token0Hash, coingeckoIdByHash, seriesByGeckoId);
    const token1 = this.buildTokenBlock(d.token1Hash, coingeckoIdByHash, seriesByGeckoId);

    const pair = this.buildPairBlock(d, coingeckoIdByHash, seriesByGeckoId);

    const velocity =
      pair.sigma60d.status === 'ok' &&
      pair.sigma365d.status === 'ok' &&
      pair.sigma60d.value !== undefined &&
      pair.sigma365d.value !== undefined &&
      pair.sigma365d.value !== 0
        ? pair.sigma60d.value / pair.sigma365d.value
        : null;

    const volatility: VolatilityBlock = {
      token0: blockFromTokenVolatility(token0, d.token0Hash),
      token1: blockFromTokenVolatility(token1, d.token1Hash),
      pair,
      velocity,
      pivotCurrency: 'usd',
      computedAt,
    };

    // Fee-APR — raw rates per PRD §3.2
    const feeApr24h = feeAprFromTvlAndFees(d.fees24hUSD, d.tvlUSD);
    const feeApr7dAvg = feeAprFromTvlAndFees(d.fees7dAvgUSD, d.tvlUSD);
    const feeAprPrimary = feeApr7dAvg; // canonical per PRD §3.2
    const feeAprSource: PoolSigmaResult['feeAprSource'] =
      feeAprPrimary === null ? 'unavailable' : '7d_avg';

    const sigmaFilter = buildSigmaFilter(feeAprPrimary, pair);

    return {
      poolHash: d.poolHash,
      feeApr24h,
      feeApr7dAvg,
      feeAprPrimary,
      feeAprSource,
      volatility,
      sigmaFilter,
    };
  }

  /**
   * Build the per-token σ-vs-USD result. Returns a TokenVolatility shape that
   * carries enough info to construct the public block.
   */
  private buildTokenBlock(
    tokenHash: string,
    coingeckoIdByHash: ReadonlyMap<string, string | null>,
    seriesByGeckoId: ReadonlyMap<string, DailyPriceSeries>,
  ): TokenVolatility {
    const id = coingeckoIdByHash.get(tokenHash) ?? null;
    if (!id) {
      const result: SigmaResult = { status: 'token_not_listed' };
      return {
        ref: tokenHash,
        status: 'token_not_listed',
        sigma60d: result,
        sigma365d: result,
      };
    }

    const series = seriesByGeckoId.get(id);
    if (!series) {
      // Should not happen if fetchSeriesForUnique covered all resolved ids,
      // but defend explicitly. Treat as fetch_failed.
      const result: SigmaResult = { status: 'fetch_failed' };
      return {
        ref: tokenHash,
        status: 'fetch_failed',
        sigma60d: result,
        sigma365d: result,
      };
    }

    return this.volatilityService.computeFromSeries(series, tokenHash);
  }

  /**
   * Build the synthetic cross-pair σ block.
   *
   * Direction is `price0 / price1` — log-return σ is exactly direction-neutral
   * (σ(ln(A/B)) = σ(ln(B/A))), so the verdict is unaffected. Do not "fix" this
   * to one direction: future readers, leave it alone.
   */
  private buildPairBlock(
    d: PoolSigmaDescriptor,
    coingeckoIdByHash: ReadonlyMap<string, string | null>,
    seriesByGeckoId: ReadonlyMap<string, DailyPriceSeries>,
  ): PairVolatilityBlock {
    const id0 = coingeckoIdByHash.get(d.token0Hash) ?? null;
    const id1 = coingeckoIdByHash.get(d.token1Hash) ?? null;

    const status0: SigmaStatus = id0 ? (seriesByGeckoId.get(id0)?.status ?? 'fetch_failed') : 'token_not_listed';
    const status1: SigmaStatus = id1 ? (seriesByGeckoId.get(id1)?.status ?? 'fetch_failed') : 'token_not_listed';

    if (status0 !== 'ok' || status1 !== 'ok') {
      // Cascade: when either leg is non-ok, pair is at least insufficient_history;
      // a stronger status (token_not_listed, fetch_failed) on a leg propagates
      // to per-window status as cascade rules dictate.
      const cascaded = cascadeStatus(status0, status1);
      const result: SigmaResult = { status: cascaded === 'ok' ? 'insufficient_history' : cascaded };
      return { sigma60d: result, sigma365d: result };
    }

    const series0 = seriesByGeckoId.get(id0!)!;
    const series1 = seriesByGeckoId.get(id1!)!;
    if (!series0.closes || !series1.closes) {
      const result: SigmaResult = { status: 'fetch_failed' };
      return { sigma60d: result, sigma365d: result };
    }

    const aligned = alignDailySeries(series0.closes, series1.closes);
    const cross: DailyPriceObservation[] = aligned.dates.map((date, i) => ({
      date,
      price: aligned.priceA[i]! / aligned.priceB[i]!,
    }));

    return {
      sigma60d: pairSigmaForWindow(cross, WINDOW_60D),
      sigma365d: pairSigmaForWindow(cross, WINDOW_365D),
    };
  }
}

// -------------------- module-level helpers --------------------

/**
 * Parse a `tokenHash` string `{type}/{chainId}/{address}` into structured form.
 * v1 supports `erc20/...`. Returns `null` if the format is unsupported or
 * malformed — caller treats null as `token_not_listed`.
 */
function parseTokenHash(
  tokenHash: string,
): { type: string; chainId: number; address: string } | null {
  const parts = tokenHash.split('/');
  if (parts.length !== 3) return null;
  const [type, chainIdStr, address] = parts as [string, string, string];
  if (type !== 'erc20') return null;
  const chainId = Number(chainIdStr);
  if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) return null;
  if (!address.startsWith('0x')) return null;
  return { type, chainId, address };
}

function blockFromTokenVolatility(
  tv: TokenVolatility,
  ref: string,
): TokenVolatilityBlock {
  return {
    ref,
    sigma60d: tv.sigma60d,
    sigma365d: tv.sigma365d,
  };
}

function buildSigmaFilter(
  feeApr: number | null,
  pair: PairVolatilityBlock,
): SigmaFilterBlock {
  const sigmaSqOver8_365d = pair.sigma365d.status === 'ok' ? pair.sigma365d.sigmaSqOver8 ?? null : null;
  const sigmaSqOver8_60d = pair.sigma60d.status === 'ok' ? pair.sigma60d.sigmaSqOver8 ?? null : null;

  const marginLongTerm =
    feeApr !== null && sigmaSqOver8_365d !== null ? feeApr - sigmaSqOver8_365d : null;
  const marginShortTerm =
    feeApr !== null && sigmaSqOver8_60d !== null ? feeApr - sigmaSqOver8_60d : null;

  const verdictLongTerm: SigmaVerdict = sigmaVerdict(feeApr, sigmaSqOver8_365d);
  const verdictShortTerm: SigmaVerdict = sigmaVerdict(feeApr, sigmaSqOver8_60d);
  const agreement = verdictAgreement(verdictLongTerm, verdictShortTerm);

  return {
    feeApr,
    sigmaSqOver8_365d,
    sigmaSqOver8_60d,
    marginLongTerm,
    marginShortTerm,
    verdictLongTerm,
    verdictShortTerm,
    verdictAgreement: agreement,
  };
}
