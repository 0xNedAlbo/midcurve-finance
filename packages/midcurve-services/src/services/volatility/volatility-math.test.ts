import { describe, it, expect } from 'vitest';
import {
  alignDailySeries,
  annualisedSigma,
  bucketByIsoDate,
  cascadeStatus,
  coverageBand,
  coverageRatio,
  dailyLogReturns,
  feeAprFromTvlAndFees,
  pairSigmaForWindow,
  sampleVariance,
  sigmaForWindow,
  sigmaVerdict,
  verdictAgreement,
  type DailyPriceObservation,
} from './volatility-math.js';

const DAY_MS = 86_400_000;
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

describe('bucketByIsoDate', () => {
  it('returns one observation per UTC date, latest sample wins', () => {
    const points: Array<[number, number]> = [
      [dayMs('2026-01-01') + 1_000, 100],
      [dayMs('2026-01-01') + 5_000, 110], // later sample, same UTC date
      [dayMs('2026-01-02') + 0, 120],
    ];
    const bucketed = bucketByIsoDate(points);
    expect(bucketed).toEqual([
      { date: '2026-01-01', price: 110 },
      { date: '2026-01-02', price: 120 },
    ]);
  });

  it('treats UTC-midnight crossing consistently', () => {
    // 23:59 UTC on Jan 1 vs. 00:01 UTC on Jan 2 — different ISO dates regardless of host TZ
    const jan1End = dayMs('2026-01-01') + 23 * 3600_000 + 59 * 60_000;
    const jan2Start = dayMs('2026-01-02') + 60_000;
    const bucketed = bucketByIsoDate([
      [jan1End, 100],
      [jan2Start, 200],
    ]);
    expect(bucketed.map((b) => b.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('skips non-finite entries', () => {
    const bucketed = bucketByIsoDate([
      [dayMs('2026-01-01'), Number.NaN],
      [dayMs('2026-01-02'), 200],
    ]);
    expect(bucketed).toEqual([{ date: '2026-01-02', price: 200 }]);
  });

  it('returns sorted ascending by date when input is unsorted', () => {
    const bucketed = bucketByIsoDate([
      [dayMs('2026-01-03'), 30],
      [dayMs('2026-01-01'), 10],
      [dayMs('2026-01-02'), 20],
    ]);
    expect(bucketed.map((b) => b.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });
});

describe('alignDailySeries', () => {
  const a: DailyPriceObservation[] = [
    { date: '2026-01-01', price: 100 },
    { date: '2026-01-02', price: 110 },
    { date: '2026-01-03', price: 120 },
    { date: '2026-01-04', price: 130 },
  ];
  const b: DailyPriceObservation[] = [
    { date: '2026-01-02', price: 1.0 },
    { date: '2026-01-03', price: 1.1 },
    { date: '2026-01-04', price: 1.2 },
    { date: '2026-01-05', price: 1.3 },
  ];

  it('inner-joins by ISO date', () => {
    const { dates, priceA, priceB } = alignDailySeries(a, b);
    expect(dates).toEqual(['2026-01-02', '2026-01-03', '2026-01-04']);
    expect(priceA).toEqual([110, 120, 130]);
    expect(priceB).toEqual([1.0, 1.1, 1.2]);
  });

  it('returns empty arrays when no dates intersect', () => {
    const c: DailyPriceObservation[] = [
      { date: '2027-06-01', price: 1 },
      { date: '2027-06-02', price: 2 },
    ];
    const aligned = alignDailySeries(a, c);
    expect(aligned).toEqual({ dates: [], priceA: [], priceB: [] });
  });

  it('produces equal-length arrays in sorted ascending order', () => {
    const aShuffled: DailyPriceObservation[] = [...a].reverse();
    const { dates, priceA, priceB } = alignDailySeries(aShuffled, b);
    expect(dates).toEqual(['2026-01-02', '2026-01-03', '2026-01-04']);
    expect(priceA.length).toBe(dates.length);
    expect(priceB.length).toBe(dates.length);
  });
});

describe('dailyLogReturns', () => {
  it('produces n-1 outputs from n inputs', () => {
    const series: DailyPriceObservation[] = [
      { date: '2026-01-01', price: 100 },
      { date: '2026-01-02', price: 110 },
      { date: '2026-01-03', price: 121 },
    ];
    const r = dailyLogReturns(series);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(Math.log(110 / 100), 12);
    expect(r[1]).toBeCloseTo(Math.log(121 / 110), 12);
  });

  it('throws on non-positive price', () => {
    const series: DailyPriceObservation[] = [
      { date: '2026-01-01', price: 100 },
      { date: '2026-01-02', price: 0 },
    ];
    expect(() => dailyLogReturns(series)).toThrow(/non-positive/);
  });

  it('throws on negative price', () => {
    const series: DailyPriceObservation[] = [
      { date: '2026-01-01', price: 100 },
      { date: '2026-01-02', price: -1 },
    ];
    expect(() => dailyLogReturns(series)).toThrow(/non-positive/);
  });

  it('returns [] for a single-point series', () => {
    expect(dailyLogReturns([{ date: '2026-01-01', price: 100 }])).toEqual([]);
  });

  it('returns [] for an empty series', () => {
    expect(dailyLogReturns([])).toEqual([]);
  });
});

describe('sampleVariance', () => {
  it('matches numpy np.var(x, ddof=1) on a known vector', () => {
    // numpy reference:
    //   x = np.array([1, 2, 3, 4, 5])
    //   np.var(x, ddof=1) -> 2.5
    expect(sampleVariance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 12);
  });

  it('matches the hand-computed value on an asymmetric vector', () => {
    // x = [0.1, -0.05, 0.2, 0.15, -0.1, 0.0]
    // mean = 0.05
    // squared deviations: 0.0025, 0.01, 0.0225, 0.01, 0.0225, 0.0025  (sum = 0.07)
    // ddof=1 ⇒ 0.07 / 5 = 0.014
    expect(
      sampleVariance([0.1, -0.05, 0.2, 0.15, -0.1, 0.0]),
    ).toBeCloseTo(0.014, 12);
  });

  it('throws when n < 2', () => {
    expect(() => sampleVariance([])).toThrow();
    expect(() => sampleVariance([1])).toThrow();
  });

  it('returns 0 for constant series', () => {
    expect(sampleVariance([3, 3, 3, 3])).toBe(0);
  });
});

describe('annualisedSigma', () => {
  it('multiplies by √365 by default', () => {
    // sampleVariance([1,2,3,4,5]) === 2.5 → σ = √(2.5 × 365)
    expect(annualisedSigma([1, 2, 3, 4, 5])).toBeCloseTo(
      Math.sqrt(2.5 * 365),
      12,
    );
  });

  it('accepts custom periodsPerYear', () => {
    expect(annualisedSigma([1, 2, 3, 4, 5], 252)).toBeCloseTo(
      Math.sqrt(2.5 * 252),
      12,
    );
  });
});

describe('sigmaForWindow', () => {
  function constantGrowthSeries(days: number, dailyMultiplier: number): DailyPriceObservation[] {
    const out: DailyPriceObservation[] = [];
    let p = 100;
    for (let i = 0; i < days; i++) {
      const d = new Date(dayMs('2026-01-01') + i * DAY_MS);
      out.push({
        date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
        price: p,
      });
      p *= dailyMultiplier;
    }
    return out;
  }

  it('returns insufficient_history when fewer than window log returns are available', () => {
    // 60 prices → 59 log returns; window=60 must fail
    const series = constantGrowthSeries(60, 1.0);
    expect(sigmaForWindow(series, 60).status).toBe('insufficient_history');
  });

  it('returns ok when exactly window log returns are available', () => {
    // 61 prices → 60 log returns; window=60 succeeds
    const series = constantGrowthSeries(61, 1.001);
    const result = sigmaForWindow(series, 60);
    expect(result.status).toBe('ok');
    expect(result.nReturns).toBe(60);
    expect(typeof result.value).toBe('number');
  });

  it('returns σ ≈ 0 for a constant-multiplier series (all returns identical → variance 0)', () => {
    const series = constantGrowthSeries(70, 1.001);
    const result = sigmaForWindow(series, 60);
    expect(result.value).toBeCloseTo(0, 10);
  });

  it('returns insufficient_history on non-positive prices', () => {
    const series: DailyPriceObservation[] = [
      { date: '2026-01-01', price: 100 },
      { date: '2026-01-02', price: 0 },
      { date: '2026-01-03', price: 100 },
    ];
    expect(sigmaForWindow(series, 1).status).toBe('insufficient_history');
  });

  it('uses only the trailing window when more data is available', () => {
    // Build a series where the *last* 60 log returns are all zero. With 31
    // noisy prices followed by 61 constant prices, the returns array is 91
    // long; the last 60 returns are between the 61 constant prices = zeros.
    const series: DailyPriceObservation[] = [];
    let p = 100;
    let day = dayMs('2025-01-01');
    for (let i = 0; i < 31; i++) {
      series.push({ date: isoDate(day), price: p });
      day += DAY_MS;
      // alternate up/down to introduce variance
      p *= i % 2 === 0 ? 1.05 : 0.95;
    }
    for (let i = 0; i < 61; i++) {
      series.push({ date: isoDate(day), price: p });
      day += DAY_MS;
      // perfectly constant — zero log return
    }
    const result = sigmaForWindow(series, 60);
    expect(result.status).toBe('ok');
    expect(result.value).toBeCloseTo(0, 10);
  });
});

describe('pairSigmaForWindow', () => {
  it('returns sigmaSqOver8 alongside value when ok', () => {
    // Synthetic series with constant log return ln(1.1) per step, window=2 returns
    const series: DailyPriceObservation[] = [
      { date: '2026-01-01', price: 100 },
      { date: '2026-01-02', price: 110 },
      { date: '2026-01-03', price: 121 },
    ];
    const result = pairSigmaForWindow(series, 2);
    expect(result.status).toBe('ok');
    // Constant log return → variance 0 → σ 0 → σ²/8 = 0
    expect(result.value).toBeCloseTo(0, 12);
    expect(result.sigmaSqOver8).toBeCloseTo(0, 12);
  });

  it('omits sigmaSqOver8 when status is not ok', () => {
    const result = pairSigmaForWindow([], 60);
    expect(result.status).toBe('insufficient_history');
    expect(result.sigmaSqOver8).toBeUndefined();
  });

  it('computes σ²/8 correctly on a known vector', () => {
    // Hand-craft: returns = [0.1, -0.1] → mean 0, variance (0.01+0.01)/1 = 0.02
    // σ_daily = √0.02; σ_annual = √(0.02 × 365); σ²_annual = 0.02 × 365 = 7.3; /8 = 0.9125
    const series: DailyPriceObservation[] = [
      { date: '2026-01-01', price: Math.exp(0) }, // 1
      { date: '2026-01-02', price: Math.exp(0.1) },
      { date: '2026-01-03', price: Math.exp(0.0) }, // back to 1: r2 = -0.1
    ];
    const result = pairSigmaForWindow(series, 2);
    expect(result.status).toBe('ok');
    expect(result.value).toBeCloseTo(Math.sqrt(0.02 * 365), 10);
    expect(result.sigmaSqOver8).toBeCloseTo((0.02 * 365) / 8, 10);
  });

  it('pair σ is invariant under direction reversal', () => {
    // σ(ln(A/B)) = σ(ln(B/A)) exactly for log returns:
    //   ln(B/A) = -ln(A/B), and variance is invariant under sign flip.
    // This pins the property so a future reader doesn't "fix" the
    // cross-series direction in pool-sigma-filter-service.
    const ab: DailyPriceObservation[] = [
      { date: '2026-01-01', price: 100 },
      { date: '2026-01-02', price: 110 },
      { date: '2026-01-03', price: 105 },
      { date: '2026-01-04', price: 120 },
    ];
    const ba: DailyPriceObservation[] = ab.map((o) => ({
      date: o.date,
      price: 1 / o.price,
    }));
    expect(pairSigmaForWindow(ab, 2).value).toBeCloseTo(
      pairSigmaForWindow(ba, 2).value!,
      12,
    );
    expect(pairSigmaForWindow(ab, 2).sigmaSqOver8).toBeCloseTo(
      pairSigmaForWindow(ba, 2).sigmaSqOver8!,
      12,
    );
  });
});

describe('feeAprFromTvlAndFees', () => {
  it('computes raw rate (fees/tvl)*365', () => {
    expect(feeAprFromTvlAndFees('100', '36500')).toBeCloseTo(1.0, 12);
  });

  it('returns null when tvl is zero', () => {
    expect(feeAprFromTvlAndFees('100', '0')).toBeNull();
  });

  it('returns null when tvl is negative', () => {
    expect(feeAprFromTvlAndFees('100', '-5')).toBeNull();
  });

  it('returns null when tvl is null/undefined', () => {
    expect(feeAprFromTvlAndFees('100', null)).toBeNull();
    expect(feeAprFromTvlAndFees('100', undefined)).toBeNull();
  });

  it('returns null when fees is null/undefined', () => {
    expect(feeAprFromTvlAndFees(null, '100')).toBeNull();
    expect(feeAprFromTvlAndFees(undefined, '100')).toBeNull();
  });

  it('returns null when tvl is non-numeric', () => {
    expect(feeAprFromTvlAndFees('100', 'NaN')).toBeNull();
    expect(feeAprFromTvlAndFees('100', 'abc')).toBeNull();
  });

  it('accepts numeric inputs as well as string', () => {
    expect(feeAprFromTvlAndFees(100, 36500)).toBeCloseTo(1.0, 12);
  });

  it('matches the PRD §12 fixture: fees7dAvg=9108.74, tvl=13236595.15 → ≈ 0.2512', () => {
    const apr = feeAprFromTvlAndFees('9108.74', '13236595.15');
    expect(apr).not.toBeNull();
    expect(apr!).toBeCloseTo(0.2512, 4);
  });
});

describe('sigmaVerdict', () => {
  it('returns INSUFFICIENT_DATA when σ²/8 is null', () => {
    expect(sigmaVerdict(0.5, null)).toBe('INSUFFICIENT_DATA');
  });

  it('returns INSUFFICIENT_DATA when feeApr is null', () => {
    expect(sigmaVerdict(null, 0.05)).toBe('INSUFFICIENT_DATA');
  });

  it('returns PASS when feeApr > σ²/8', () => {
    expect(sigmaVerdict(0.25, 0.06)).toBe('PASS');
  });

  it('returns FAIL when feeApr < σ²/8', () => {
    expect(sigmaVerdict(0.04, 0.06)).toBe('FAIL');
  });

  it('returns FAIL when feeApr === σ²/8 (strict >)', () => {
    expect(sigmaVerdict(0.06, 0.06)).toBe('FAIL');
  });
});

describe('verdictAgreement', () => {
  it('returns AGREE when both PASS', () => {
    expect(verdictAgreement('PASS', 'PASS')).toBe('AGREE');
  });

  it('returns AGREE when both FAIL', () => {
    expect(verdictAgreement('FAIL', 'FAIL')).toBe('AGREE');
  });

  it('returns DIVERGENT when one PASS, one FAIL', () => {
    expect(verdictAgreement('PASS', 'FAIL')).toBe('DIVERGENT');
    expect(verdictAgreement('FAIL', 'PASS')).toBe('DIVERGENT');
  });

  it('returns INSUFFICIENT_DATA when either side is INSUFFICIENT_DATA', () => {
    expect(verdictAgreement('INSUFFICIENT_DATA', 'PASS')).toBe('INSUFFICIENT_DATA');
    expect(verdictAgreement('PASS', 'INSUFFICIENT_DATA')).toBe('INSUFFICIENT_DATA');
    expect(verdictAgreement('INSUFFICIENT_DATA', 'INSUFFICIENT_DATA')).toBe(
      'INSUFFICIENT_DATA',
    );
  });
});

describe('cascadeStatus', () => {
  it('returns ok when all inputs are ok', () => {
    expect(cascadeStatus('ok', 'ok', 'ok')).toBe('ok');
  });

  it('returns insufficient_history when present and no stronger', () => {
    expect(cascadeStatus('ok', 'insufficient_history')).toBe(
      'insufficient_history',
    );
  });

  it('prefers token_not_listed over insufficient_history', () => {
    expect(cascadeStatus('insufficient_history', 'token_not_listed')).toBe(
      'token_not_listed',
    );
  });

  it('prefers fetch_failed over token_not_listed', () => {
    expect(cascadeStatus('token_not_listed', 'fetch_failed')).toBe(
      'fetch_failed',
    );
  });

  it('returns ok for empty input', () => {
    expect(cascadeStatus()).toBe('ok');
  });
});

describe('coverageRatio', () => {
  it('returns null when feeApr is null', () => {
    expect(coverageRatio(null, 0.05)).toBeNull();
  });

  it('returns null when sigmaSqOver8 is null', () => {
    expect(coverageRatio(0.25, null)).toBeNull();
  });

  it('returns null when sigmaSqOver8 is zero', () => {
    expect(coverageRatio(0.25, 0)).toBeNull();
  });

  it('returns null when sigmaSqOver8 is negative (defensive)', () => {
    expect(coverageRatio(0.25, -0.01)).toBeNull();
  });

  it('computes feeApr / sigmaSqOver8 when both operands are valid', () => {
    expect(coverageRatio(0.25, 0.1)).toBeCloseTo(2.5, 12);
    expect(coverageRatio(0.05, 0.1)).toBeCloseTo(0.5, 12);
  });

  it('handles a zero feeApr (degenerate but well-defined)', () => {
    expect(coverageRatio(0, 0.1)).toBe(0);
  });
});

describe('coverageBand', () => {
  it('returns insufficient_data when coverage is null', () => {
    expect(coverageBand(null)).toBe('insufficient_data');
  });

  it('returns deep_red for coverage strictly below 0.5', () => {
    expect(coverageBand(0)).toBe('deep_red');
    expect(coverageBand(0.4999)).toBe('deep_red');
  });

  it('returns red on the inclusive lower bound 0.5', () => {
    expect(coverageBand(0.5)).toBe('red');
  });

  it('returns red across [0.5, 0.9)', () => {
    expect(coverageBand(0.7)).toBe('red');
    expect(coverageBand(0.8999)).toBe('red');
  });

  it('returns yellow on the inclusive lower bound 0.9', () => {
    expect(coverageBand(0.9)).toBe('yellow');
  });

  it('returns yellow across [0.9, 1.5)', () => {
    expect(coverageBand(1.0)).toBe('yellow');
    expect(coverageBand(1.4999)).toBe('yellow');
  });

  it('returns green on the inclusive lower bound 1.5', () => {
    expect(coverageBand(1.5)).toBe('green');
  });

  it('returns green across [1.5, 3.0)', () => {
    expect(coverageBand(2.0)).toBe('green');
    expect(coverageBand(2.9999)).toBe('green');
  });

  it('returns deep_green on the inclusive lower bound 3.0', () => {
    expect(coverageBand(3.0)).toBe('deep_green');
  });

  it('returns deep_green for arbitrarily large coverage', () => {
    expect(coverageBand(10)).toBe('deep_green');
    expect(coverageBand(1_000)).toBe('deep_green');
  });

  it('round-trip with sigmaVerdict: coverage < 1 ⇒ FAIL, coverage > 1 ⇒ PASS', () => {
    // The verdict uses strict feeApr > sigmaSqOver8, so the ↔ at exactly
    // coverage = 1.0 lands on FAIL — we test strict inequalities only.
    const feeApr = 0.05;
    expect(coverageRatio(feeApr, feeApr * 2)).toBeCloseTo(0.5, 12); // < 1
    expect(sigmaVerdict(feeApr, feeApr * 2)).toBe('FAIL');
    expect(coverageRatio(feeApr, feeApr / 2)).toBeCloseTo(2.0, 12); // > 1
    expect(sigmaVerdict(feeApr, feeApr / 2)).toBe('PASS');
  });
});

// -------------------- helpers --------------------

function isoDate(unixMs: number): string {
  const d = new Date(unixMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
