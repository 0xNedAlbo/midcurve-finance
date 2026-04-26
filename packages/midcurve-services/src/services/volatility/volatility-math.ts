/**
 * Volatility math primitives.
 *
 * Pure, total functions — no I/O, no service deps. The only non-trivial
 * algorithm in the σ-filter feature lives here. See PRD §4 for spec.
 *
 * Critical defaults (PRD §4.3):
 * - Returns: log returns `ln(P_t / P_{t-1})`
 * - Annualization: `√365` (24/7 markets)
 * - Sample variance: Bessel-corrected (`ddof=1`, divide by `n-1`)
 * - Date alignment: ISO date string `YYYY-MM-DD` from UTC timestamp
 * - Zero/negative prices: invalidate the whole series for the window
 */

import type {
  PairSigmaResult,
  SigmaResult,
  SigmaStatus,
  SigmaVerdict,
  VerdictAgreement,
} from '@midcurve/api-shared';

const PERIODS_PER_YEAR_24_7 = 365;

/**
 * One observation per UTC day, sorted ascending.
 */
export interface DailyPriceObservation {
  /** ISO date string `YYYY-MM-DD` derived from the UTC timestamp. */
  date: string;
  /** Price in the pivot currency (USD in v1). Must be finite and > 0. */
  price: number;
}

/**
 * CoinGecko returns hourly-ish observations even when `interval=daily` is
 * requested for sub-90-day windows. Bucket them down to one-per-UTC-date
 * (latest sample wins on ties), per PRD §4.1 ISO-date alignment.
 *
 * @param rawPoints `[unixMs, price]` tuples as returned by CoinGecko's
 *                  `prices` array. Order is not assumed.
 * @returns observations sorted ascending by date.
 */
export function bucketByIsoDate(
  rawPoints: ReadonlyArray<readonly [number, number]>,
): DailyPriceObservation[] {
  const latestPerDate = new Map<string, { ts: number; price: number }>();

  for (const [ts, price] of rawPoints) {
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    const date = isoDateUtc(ts);
    const existing = latestPerDate.get(date);
    if (!existing || ts > existing.ts) {
      latestPerDate.set(date, { ts, price });
    }
  }

  return [...latestPerDate.entries()]
    .map(([date, { price }]) => ({ date, price }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Inner-join two daily series by ISO-date string. Output has equal-length
 * arrays of `dates`, `priceA`, `priceB` for dates present in both inputs,
 * sorted ascending.
 */
export function alignDailySeries(
  a: ReadonlyArray<DailyPriceObservation>,
  b: ReadonlyArray<DailyPriceObservation>,
): { dates: string[]; priceA: number[]; priceB: number[] } {
  const bByDate = new Map<string, number>();
  for (const obs of b) bByDate.set(obs.date, obs.price);

  const dates: string[] = [];
  const priceA: number[] = [];
  const priceB: number[] = [];

  for (const obs of a) {
    const matched = bByDate.get(obs.date);
    if (matched === undefined) continue;
    dates.push(obs.date);
    priceA.push(obs.price);
    priceB.push(matched);
  }

  // a was iterated in its own order; sort by date to be safe.
  const order = dates
    .map((_, i) => i)
    .sort((i, j) => (dates[i]! < dates[j]! ? -1 : dates[i]! > dates[j]! ? 1 : 0));

  return {
    dates: order.map((i) => dates[i]!),
    priceA: order.map((i) => priceA[i]!),
    priceB: order.map((i) => priceB[i]!),
  };
}

/**
 * Daily log returns over an ascending price series.
 *
 * - Output length is `series.length - 1`
 * - Throws if any price is non-positive (per PRD §4.2 the entire series is
 *   invalidated; callers should report `insufficient_history`)
 */
export function dailyLogReturns(
  series: ReadonlyArray<DailyPriceObservation>,
): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.price;
    const curr = series[i]!.price;
    if (!(prev > 0) || !(curr > 0)) {
      throw new Error('non-positive price in series — series is invalid');
    }
    out.push(Math.log(curr / prev));
  }
  return out;
}

/**
 * Bessel-corrected sample variance (`ddof=1`, divide by `n-1`).
 *
 * Throws if `values.length < 2`.
 */
export function sampleVariance(values: ReadonlyArray<number>): number {
  if (values.length < 2) {
    throw new Error('sampleVariance requires at least 2 observations');
  }
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sse = 0;
  for (const v of values) {
    const d = v - mean;
    sse += d * d;
  }
  return sse / (values.length - 1);
}

/**
 * Annualised σ — `√(variance × periodsPerYear)`.
 *
 * Default `periodsPerYear` is 365 (crypto / 24-7 markets). Throws if
 * `returns.length < 2`.
 */
export function annualisedSigma(
  returns: ReadonlyArray<number>,
  periodsPerYear: number = PERIODS_PER_YEAR_24_7,
): number {
  return Math.sqrt(sampleVariance(returns) * periodsPerYear);
}

/**
 * Compute σ for a window of `windowDays` over a daily price series.
 *
 * - If the series yields fewer than `windowDays` daily log returns, returns
 *   `{ status: 'insufficient_history' }`.
 * - On non-positive prices in the series, returns `{ status: 'insufficient_history' }`.
 * - On success, returns `{ status: 'ok', value, nReturns: windowDays }`.
 */
export function sigmaForWindow(
  series: ReadonlyArray<DailyPriceObservation>,
  windowDays: number,
): SigmaResult {
  let returns: number[];
  try {
    returns = dailyLogReturns(series);
  } catch {
    return { status: 'insufficient_history' };
  }
  if (returns.length < windowDays) {
    return { status: 'insufficient_history' };
  }
  const slice = returns.slice(-windowDays);
  const value = annualisedSigma(slice);
  return { status: 'ok', value, nReturns: windowDays };
}

/**
 * Convenience: σ for the pair (cross) series, returning the LVR threshold
 * `value² / 8` alongside the σ value.
 */
export function pairSigmaForWindow(
  series: ReadonlyArray<DailyPriceObservation>,
  windowDays: number,
): PairSigmaResult {
  const base = sigmaForWindow(series, windowDays);
  if (base.status !== 'ok' || base.value === undefined) return base;
  return { ...base, sigmaSqOver8: (base.value * base.value) / 8 };
}

/**
 * Fee-APR raw rate from period TVL and fees.
 *
 * `(feesUSD / tvlUSD) * 365`. Returns `null` when `tvlUSD` is missing,
 * non-numeric, or non-positive (PRD §3.2).
 *
 * Inputs are decimal-string from the subgraph; we parse with `Number()` —
 * the values are USD totals well within `Number.MAX_SAFE_INTEGER` precision.
 */
export function feeAprFromTvlAndFees(
  feesUSD: string | number | null | undefined,
  tvlUSD: string | number | null | undefined,
): number | null {
  const tvl = toFiniteNumber(tvlUSD);
  const fees = toFiniteNumber(feesUSD);
  if (tvl === null || tvl <= 0) return null;
  if (fees === null) return null;
  return (fees * 365) / tvl;
}

/**
 * Verdict for a single window — fee-APR vs σ²/8.
 *
 * - `null` σ²/8 → `INSUFFICIENT_DATA`
 * - `null` feeApr → `INSUFFICIENT_DATA`
 * - feeApr > σ²/8 → `PASS`
 * - else → `FAIL`
 */
export function sigmaVerdict(
  feeApr: number | null,
  sigmaSqOver8: number | null,
): SigmaVerdict {
  if (sigmaSqOver8 === null || feeApr === null) return 'INSUFFICIENT_DATA';
  if (feeApr > sigmaSqOver8) return 'PASS';
  return 'FAIL';
}

/**
 * Agreement between long-term (365d) and short-term (60d) verdicts (PRD §7).
 */
export function verdictAgreement(
  longTerm: SigmaVerdict,
  shortTerm: SigmaVerdict,
): VerdictAgreement {
  if (longTerm === 'INSUFFICIENT_DATA' || shortTerm === 'INSUFFICIENT_DATA') {
    return 'INSUFFICIENT_DATA';
  }
  return longTerm === shortTerm ? 'AGREE' : 'DIVERGENT';
}

/**
 * Strongest non-ok status from a set of inputs (PRD §3.3 cascade).
 *
 * Precedence: `fetch_failed` > `token_not_listed` > `insufficient_history`
 * > `ok`. If all inputs are `ok`, returns `ok`.
 */
export function cascadeStatus(
  ...inputs: ReadonlyArray<SigmaStatus>
): SigmaStatus {
  let result: SigmaStatus = 'ok';
  for (const s of inputs) {
    if (statusRank(s) > statusRank(result)) result = s;
  }
  return result;
}

// -------------------- internals --------------------

function statusRank(s: SigmaStatus): number {
  switch (s) {
    case 'ok':
      return 0;
    case 'insufficient_history':
      return 1;
    case 'token_not_listed':
      return 2;
    case 'fetch_failed':
      return 3;
  }
}

function isoDateUtc(unixMs: number): string {
  const d = new Date(unixMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function toFiniteNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
