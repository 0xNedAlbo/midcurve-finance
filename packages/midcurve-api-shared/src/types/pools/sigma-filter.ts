/**
 * Pool Sigma-Filter Types
 *
 * Public response contract for the volatility (σ) and σ-filter blocks added to
 * the `metrics` field of pool API responses. See PRD-pool-sigma-filter.md.
 *
 * Platform-agnostic — applies to any 2-token AMM whose tokens have a
 * CoinGecko listing. The verdict (`sigmaFilter.verdict*`) compares the
 * pool's fee-APR against `σ²/8` (the LVR threshold).
 */

/**
 * Status of a single σ computation.
 *
 * - `ok` — value is present and reliable
 * - `insufficient_history` — the token has fewer than `nReturns` daily
 *   observations available (or the cross-pair has fewer aligned observations)
 * - `token_not_listed` — the token is not present in the CoingeckoToken table
 * - `fetch_failed` — CoinGecko fetch errored (transient; retried on next request after the cache TTL)
 */
export type SigmaStatus =
  | 'ok'
  | 'insufficient_history'
  | 'token_not_listed'
  | 'fetch_failed';

/**
 * Verdict for a single window comparing fee-APR to σ²/8.
 */
export type SigmaVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';

/**
 * Agreement between long-term (365d) and short-term (60d) verdicts.
 */
export type VerdictAgreement = 'AGREE' | 'DIVERGENT' | 'INSUFFICIENT_DATA';

/**
 * Discrete 5-band mapping derived from the LVR-coverage ratio
 * (`feeApr / sigmaSqOver8_365d`). See RFC-0001 for canonical cutoffs.
 *
 * Cutoffs (half-open intervals, left bound inclusive):
 * - `coverage < 0.5` → `deep_red`
 * - `0.5 ≤ coverage < 0.9` → `red`
 * - `0.9 ≤ coverage < 1.5` → `yellow`
 * - `1.5 ≤ coverage < 3.0` → `green`
 * - `coverage ≥ 3.0` → `deep_green`
 * - `coverage === null` → `insufficient_data`
 */
export type CoverageBand =
  | 'deep_red'
  | 'red'
  | 'yellow'
  | 'green'
  | 'deep_green'
  | 'insufficient_data';

/**
 * Source window used for `feeAprPrimary`.
 */
export type FeeAprSource = '24h' | '7d_avg' | 'unavailable';

/**
 * σ result for a single token-vs-USD window.
 *
 * `value` and `nReturns` are present only when `status === 'ok'`.
 */
export interface SigmaResult {
  status: SigmaStatus;
  /** Annualised σ (raw rate, e.g. 0.6382 = 63.82%). Present iff status === 'ok'. */
  value?: number;
  /** Number of daily log-returns the σ was computed over. */
  nReturns?: number;
}

/**
 * σ result for the synthetic cross-pair series, with the LVR threshold.
 *
 * `sigmaSqOver8` is `value² / 8` and is what the verdict actually compares against.
 */
export interface PairSigmaResult extends SigmaResult {
  /** value² / 8 — the LVR threshold (PRD §1, §7). */
  sigmaSqOver8?: number;
}

/**
 * Per-token σ block — token vs USD across the 60d and 365d windows.
 *
 * Token labels are `token0` / `token1` (Uniswap canonical ordering by address).
 * NOT base/quote — base/quote is a position-level concept (which side the LP
 * is long), not a pool-level one.
 */
export interface TokenVolatilityBlock {
  /** Token reference: `erc20/{chainId}/{address}` or `coingecko/{geckoId}`. */
  ref: string;
  sigma60d: SigmaResult;
  sigma365d: SigmaResult;
}

/**
 * Pair-σ block — synthetic cross series across both windows.
 *
 * Pair-σ is direction-neutral for log returns: σ(ln(A/B)) = σ(ln(B/A))
 * exactly, so the choice of which token is numerator does not affect the
 * verdict.
 */
export interface PairVolatilityBlock {
  sigma60d: PairSigmaResult;
  sigma365d: PairSigmaResult;
}

/**
 * Full volatility block on `metrics.volatility`.
 */
export interface VolatilityBlock {
  token0: TokenVolatilityBlock;
  token1: TokenVolatilityBlock;
  pair: PairVolatilityBlock;
  /**
   * Volatility velocity — `pair.sigma60d.value / pair.sigma365d.value`.
   *
   * Indicator of vol-regime change. `null` when either window is non-ok.
   */
  velocity: number | null;
  /** Pivot currency. Fixed to `'usd'` in v1. */
  pivotCurrency: 'usd';
  /** ISO-8601 timestamp at which this block was computed. */
  computedAt: string;
}

/**
 * Sigma-filter block on `metrics.sigmaFilter`.
 *
 * Field naming intentionally mixes snake-case windows (`_365d`/`_60d`) on the
 * σ²/8 fields and camelCase on margin/verdict fields per PRD §3.4 — the
 * snake-case form encodes a concrete numerical window in the field name and
 * is future-proof against re-tuning, while the verdict/margin pair encodes a
 * semantic role.
 */
export interface SigmaFilterBlock {
  /** Mirrors `metrics.feeAprPrimary` (raw rate). `null` when unavailable. */
  feeApr: number | null;
  /** σ²/8 over the 365d window (canonical LVR threshold). `null` when non-ok. */
  sigmaSqOver8_365d: number | null;
  /** σ²/8 over the 60d window. `null` when non-ok. */
  sigmaSqOver8_60d: number | null;
  /** `feeApr - sigmaSqOver8_365d`. `null` when either operand is null. */
  marginLongTerm: number | null;
  /** `feeApr - sigmaSqOver8_60d`. `null` when either operand is null. */
  marginShortTerm: number | null;
  /** Canonical filter signal — verdict at the 365d window. */
  verdictLongTerm: SigmaVerdict;
  /** Verdict at the 60d window. */
  verdictShortTerm: SigmaVerdict;
  /** Agreement between long-term and short-term verdicts. */
  verdictAgreement: VerdictAgreement;
  /**
   * LVR-coverage ratio: `feeApr / sigmaSqOver8_365d`.
   *
   * Multiplicative analogue to `marginLongTerm`. `null` when either operand
   * is null or `sigmaSqOver8_365d <= 0` (defensive — the σ-filter shouldn't
   * produce non-positive σ²/8 for an `ok` window, but division-by-zero
   * safety is cheap).
   *
   * See RFC-0001.
   */
  coverageLongTerm: number | null;
  /**
   * Discrete 5-band mapping derived from `coverageLongTerm`.
   *
   * `'insufficient_data'` exactly when `coverageLongTerm === null`.
   * See RFC-0001 for cutoffs.
   */
  coverageBand: CoverageBand;
}
