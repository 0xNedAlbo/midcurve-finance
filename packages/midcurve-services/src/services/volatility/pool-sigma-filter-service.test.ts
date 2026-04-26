import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoingeckoTokenService } from '../coingecko-token/index.js';
import { PoolSigmaFilterService } from './pool-sigma-filter-service.js';
import type { TokenPriceSeriesService } from './token-price-series-service.js';
import type { DailyPriceSeries, PoolSigmaDescriptor } from './types.js';
import { VolatilityService } from './volatility-service.js';

/**
 * Synthetic 366-day series with constant log return per step.
 * 366 prices → 365 log returns, enough for both 60d and 365d windows.
 */
function constantGrowthSeries(
  refId: string,
  startPrice: number,
  dailyMultiplier: number,
  days: number = 366,
): DailyPriceSeries {
  const closes: { date: string; price: number }[] = [];
  let p = startPrice;
  // Anchor the series so today is the LAST date — 365d window slides to fit.
  const start = Date.UTC(2025, 0, 1); // 2025-01-01 UTC
  for (let i = 0; i < days; i++) {
    const ms = start + i * 86_400_000;
    const d = new Date(ms);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    closes.push({ date, price: p });
    p *= dailyMultiplier;
  }
  return {
    ref: `coingecko/${refId}`,
    pivotCurrency: 'usd',
    status: 'ok',
    closes,
    fetchedAt: new Date().toISOString(),
  };
}

interface MockSeriesEntry {
  geckoId: string;
  series: DailyPriceSeries;
}

function buildMocks(opts: {
  /** tokenHash → coingeckoId | null. null means not listed. */
  tokenResolutions: Map<string, string | null>;
  /** Daily series for each gecko id — non-resolved tokens are skipped. */
  seriesEntries?: MockSeriesEntry[];
}) {
  const series = new Map<string, DailyPriceSeries>();
  for (const e of opts.seriesEntries ?? []) {
    series.set(e.geckoId, e.series);
  }

  // We need access to call counts to assert dedup.
  const findByChainAndAddress = vi.fn(
    async (chainId: number, address: string) => {
      const hash = `erc20/${chainId}/${address}`;
      const id = opts.tokenResolutions.get(hash) ?? null;
      if (!id) return null;
      // CoingeckoTokenService.findByChainAndAddress returns a CoingeckoToken
      // domain object — only the .coingeckoId property is read by the service.
      return { coingeckoId: id } as unknown as Awaited<
        ReturnType<CoingeckoTokenService['findByChainAndAddress']>
      >;
    },
  );

  const getDailySeries = vi.fn(async (id: string) => {
    return series.get(id) ?? {
      ref: `coingecko/${id}`,
      pivotCurrency: 'usd' as const,
      status: 'fetch_failed' as const,
      fetchedAt: new Date().toISOString(),
    };
  });

  const tokenPriceSeriesService = {
    getDailySeries,
  } as unknown as TokenPriceSeriesService;

  // Use the real VolatilityService — it's pure compute over the mocked series.
  const volatilityService = new VolatilityService({
    tokenPriceSeriesService,
  });

  const coingeckoTokenService = {
    findByChainAndAddress,
  } as unknown as CoingeckoTokenService;

  const service = new PoolSigmaFilterService({
    tokenPriceSeriesService,
    volatilityService,
    coingeckoTokenService,
  });

  return { service, findByChainAndAddress, getDailySeries };
}

const TOKEN_A = 'erc20/8453/0xAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaa';
const TOKEN_B = 'erc20/8453/0xBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbb';
const TOKEN_C = 'erc20/8453/0xCcccCccCccccCccCccccCccCccccCccCccccCccc';

describe('PoolSigmaFilterService.enrichPools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path — both legs ok', () => {
    it('produces a PASS verdict when feeApr exceeds σ²/8', async () => {
      // Token A: tiny vol (~0% daily change) → σ ≈ 0
      // Token B: tiny vol → σ ≈ 0 → cross-pair σ ≈ 0 → σ²/8 ≈ 0
      // feeApr from large fees / large tvl → comfortably > 0
      const { service } = buildMocks({
        tokenResolutions: new Map([
          [TOKEN_A, 'token-a'],
          [TOKEN_B, 'token-b'],
        ]),
        seriesEntries: [
          { geckoId: 'token-a', series: constantGrowthSeries('token-a', 1, 1.0) },
          { geckoId: 'token-b', series: constantGrowthSeries('token-b', 1, 1.0) },
        ],
      });

      const descriptors: PoolSigmaDescriptor[] = [
        {
          poolHash: 'uniswapv3/8453/0xpool1',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_B,
          tvlUSD: '1000000',
          fees24hUSD: '500',
          fees7dAvgUSD: '500',
        },
      ];

      const result = await service.enrichPools(descriptors);
      const pool = result.get('uniswapv3/8453/0xpool1');

      expect(pool).toBeDefined();
      expect(pool!.feeApr7dAvg).toBeCloseTo((500 * 365) / 1_000_000, 12);
      expect(pool!.feeAprSource).toBe('7d_avg');
      expect(pool!.volatility.token0.sigma60d.status).toBe('ok');
      expect(pool!.volatility.pair.sigma60d.status).toBe('ok');
      expect(pool!.sigmaFilter.verdictLongTerm).toBe('PASS');
      expect(pool!.sigmaFilter.verdictShortTerm).toBe('PASS');
      expect(pool!.sigmaFilter.verdictAgreement).toBe('AGREE');
      expect(pool!.sigmaFilter.marginLongTerm).not.toBeNull();
      expect(pool!.sigmaFilter.marginLongTerm!).toBeGreaterThan(0);
    });

    it('produces a FAIL verdict when feeApr is below σ²/8', async () => {
      // Big σ on token A (alternating ±1% returns) → σ² >> feeApr at small fees
      const seriesA: DailyPriceSeries = {
        ref: 'coingecko/token-a',
        pivotCurrency: 'usd',
        status: 'ok',
        closes: makeAlternatingSeries(0.01, 366),
        fetchedAt: new Date().toISOString(),
      };
      const { service } = buildMocks({
        tokenResolutions: new Map([
          [TOKEN_A, 'token-a'],
          [TOKEN_B, 'token-b'],
        ]),
        seriesEntries: [
          { geckoId: 'token-a', series: seriesA },
          { geckoId: 'token-b', series: constantGrowthSeries('token-b', 1, 1.0) },
        ],
      });

      const descriptors: PoolSigmaDescriptor[] = [
        {
          poolHash: 'uniswapv3/8453/0xpool2',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_B,
          tvlUSD: '10000000',
          fees24hUSD: '1', // tiny → tiny APR
          fees7dAvgUSD: '1',
        },
      ];

      const result = await service.enrichPools(descriptors);
      const pool = result.get('uniswapv3/8453/0xpool2')!;

      expect(pool.sigmaFilter.verdictLongTerm).toBe('FAIL');
      expect(pool.sigmaFilter.verdictShortTerm).toBe('FAIL');
      expect(pool.sigmaFilter.verdictAgreement).toBe('AGREE');
    });
  });

  describe('insufficient data', () => {
    it('returns INSUFFICIENT_DATA when tvl is zero (feeApr null)', async () => {
      const { service } = buildMocks({
        tokenResolutions: new Map([
          [TOKEN_A, 'token-a'],
          [TOKEN_B, 'token-b'],
        ]),
        seriesEntries: [
          { geckoId: 'token-a', series: constantGrowthSeries('token-a', 1, 1.0) },
          { geckoId: 'token-b', series: constantGrowthSeries('token-b', 1, 1.0) },
        ],
      });

      const result = await service.enrichPools([
        {
          poolHash: 'uniswapv3/8453/0xpoolzero',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_B,
          tvlUSD: '0',
          fees24hUSD: '500',
          fees7dAvgUSD: '500',
        },
      ]);

      const pool = result.get('uniswapv3/8453/0xpoolzero')!;
      expect(pool.feeApr7dAvg).toBeNull();
      expect(pool.feeAprPrimary).toBeNull();
      expect(pool.feeAprSource).toBe('unavailable');
      expect(pool.sigmaFilter.feeApr).toBeNull();
      expect(pool.sigmaFilter.verdictLongTerm).toBe('INSUFFICIENT_DATA');
      expect(pool.sigmaFilter.verdictShortTerm).toBe('INSUFFICIENT_DATA');
      expect(pool.sigmaFilter.verdictAgreement).toBe('INSUFFICIENT_DATA');
      expect(pool.sigmaFilter.marginLongTerm).toBeNull();
    });

    it('cascades token_not_listed: if either leg is unlisted, pair is non-ok', async () => {
      const { service } = buildMocks({
        tokenResolutions: new Map([
          [TOKEN_A, 'token-a'],
          [TOKEN_B, null], // not in CoingeckoToken table
        ]),
        seriesEntries: [
          { geckoId: 'token-a', series: constantGrowthSeries('token-a', 1, 1.0) },
        ],
      });

      const result = await service.enrichPools([
        {
          poolHash: 'uniswapv3/8453/0xpoolunlisted',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_B,
          tvlUSD: '1000000',
          fees24hUSD: '500',
          fees7dAvgUSD: '500',
        },
      ]);

      const pool = result.get('uniswapv3/8453/0xpoolunlisted')!;

      // token0 ok, token1 not listed
      expect(pool.volatility.token0.sigma60d.status).toBe('ok');
      expect(pool.volatility.token1.sigma60d.status).toBe('token_not_listed');

      // Pair cascade: at least insufficient_history; with token_not_listed in
      // play, cascade promotes to token_not_listed
      expect(pool.volatility.pair.sigma60d.status).toBe('token_not_listed');
      expect(pool.volatility.pair.sigma365d.status).toBe('token_not_listed');

      // Verdict is INSUFFICIENT_DATA
      expect(pool.sigmaFilter.verdictLongTerm).toBe('INSUFFICIENT_DATA');
      expect(pool.sigmaFilter.verdictShortTerm).toBe('INSUFFICIENT_DATA');
      expect(pool.sigmaFilter.verdictAgreement).toBe('INSUFFICIENT_DATA');
    });

    it('reports insufficient_history per-window when token has fewer than 365 days but more than 60', async () => {
      // 100 prices → 99 returns. 60d window ok, 365d window fails.
      const seriesShort = constantGrowthSeries('token-a', 1, 1.0, 100);
      const { service } = buildMocks({
        tokenResolutions: new Map([
          [TOKEN_A, 'token-a'],
          [TOKEN_B, 'token-b'],
        ]),
        seriesEntries: [
          { geckoId: 'token-a', series: seriesShort },
          { geckoId: 'token-b', series: constantGrowthSeries('token-b', 1, 1.0, 400) },
        ],
      });

      const result = await service.enrichPools([
        {
          poolHash: 'uniswapv3/8453/0xpoolyoung',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_B,
          tvlUSD: '1000000',
          fees24hUSD: '500',
          fees7dAvgUSD: '500',
        },
      ]);

      const pool = result.get('uniswapv3/8453/0xpoolyoung')!;
      expect(pool.volatility.token0.sigma60d.status).toBe('ok');
      expect(pool.volatility.token0.sigma365d.status).toBe('insufficient_history');

      // Pair: cross series intersects on the 100 dates → 99 returns
      // 60d ok, 365d insufficient_history
      expect(pool.volatility.pair.sigma60d.status).toBe('ok');
      expect(pool.volatility.pair.sigma365d.status).toBe('insufficient_history');

      // Verdict: long-term INSUFFICIENT_DATA, short-term ok (PASS or FAIL)
      expect(pool.sigmaFilter.verdictLongTerm).toBe('INSUFFICIENT_DATA');
      expect(['PASS', 'FAIL']).toContain(pool.sigmaFilter.verdictShortTerm);
      // Agreement should be INSUFFICIENT_DATA whenever either window is unknown
      expect(pool.sigmaFilter.verdictAgreement).toBe('INSUFFICIENT_DATA');
    });

    it('treats malformed tokenHash as token_not_listed without making CG calls', async () => {
      const { service, findByChainAndAddress, getDailySeries } = buildMocks({
        tokenResolutions: new Map([[TOKEN_B, 'token-b']]),
        seriesEntries: [
          { geckoId: 'token-b', series: constantGrowthSeries('token-b', 1, 1.0) },
        ],
      });

      const result = await service.enrichPools([
        {
          poolHash: 'uniswapv3/8453/0xpoolbad',
          token0Hash: 'not-a-valid-hash',
          token1Hash: TOKEN_B,
          tvlUSD: '1000',
          fees24hUSD: '1',
          fees7dAvgUSD: '1',
        },
      ]);

      const pool = result.get('uniswapv3/8453/0xpoolbad')!;
      expect(pool.volatility.token0.sigma60d.status).toBe('token_not_listed');

      // The malformed hash must not have been sent to the Coingecko table
      const calledTokenAddresses = findByChainAndAddress.mock.calls.map((c) => c[1]);
      expect(calledTokenAddresses).not.toContain('not-a-valid-hash');

      // And no series fetch was triggered for that "token"
      const calledIds = getDailySeries.mock.calls.map((c) => c[0]);
      expect(calledIds).toEqual(['token-b']);
    });
  });

  describe('token de-duplication (PRD §6.3)', () => {
    it('resolves each unique token exactly once and fetches each series exactly once across many pools', async () => {
      // 3 pools, sharing tokens — only 3 unique token hashes (A, B, C)
      const { service, findByChainAndAddress, getDailySeries } = buildMocks({
        tokenResolutions: new Map([
          [TOKEN_A, 'token-a'],
          [TOKEN_B, 'token-b'],
          [TOKEN_C, 'token-c'],
        ]),
        seriesEntries: [
          { geckoId: 'token-a', series: constantGrowthSeries('token-a', 1, 1.0) },
          { geckoId: 'token-b', series: constantGrowthSeries('token-b', 1, 1.0) },
          { geckoId: 'token-c', series: constantGrowthSeries('token-c', 1, 1.0) },
        ],
      });

      const descriptors: PoolSigmaDescriptor[] = [
        {
          poolHash: 'uniswapv3/8453/0xpoolab',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_B,
          tvlUSD: '1000',
          fees24hUSD: '1',
          fees7dAvgUSD: '1',
        },
        {
          poolHash: 'uniswapv3/8453/0xpoolac',
          token0Hash: TOKEN_A,
          token1Hash: TOKEN_C,
          tvlUSD: '1000',
          fees24hUSD: '1',
          fees7dAvgUSD: '1',
        },
        {
          poolHash: 'uniswapv3/8453/0xpoolbc',
          token0Hash: TOKEN_B,
          token1Hash: TOKEN_C,
          tvlUSD: '1000',
          fees24hUSD: '1',
          fees7dAvgUSD: '1',
        },
      ];

      await service.enrichPools(descriptors);

      // Each unique tokenHash → exactly 1 resolution call
      expect(findByChainAndAddress).toHaveBeenCalledTimes(3);
      // Each unique geckoId → exactly 1 series fetch
      expect(getDailySeries).toHaveBeenCalledTimes(3);
    });
  });
});

// -------------------- helpers --------------------

/** Series with alternating +α / −α log returns for high σ. */
function makeAlternatingSeries(
  alpha: number,
  days: number,
): { date: string; price: number }[] {
  const closes: { date: string; price: number }[] = [];
  let p = 1;
  const start = Date.UTC(2025, 0, 1);
  for (let i = 0; i < days; i++) {
    const ms = start + i * 86_400_000;
    const d = new Date(ms);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    closes.push({ date, price: p });
    p *= i % 2 === 0 ? 1 + alpha : 1 - alpha;
  }
  return closes;
}
