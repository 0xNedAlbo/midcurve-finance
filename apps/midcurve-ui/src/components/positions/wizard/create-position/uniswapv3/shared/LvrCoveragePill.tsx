/**
 * LVR-Coverage Pill
 *
 * Renders the 5-band LVR-Coverage indicator from RFC-0001 in the pool search
 * table. Color encodes the band, text inside the pill is the coverage value
 * (or `n/a` for `insufficient_data`). Hover surfaces the underlying numbers,
 * or the reason why coverage couldn't be computed.
 */

import type {
  CoverageBand,
  PoolSearchResultItem,
  SigmaFilterBlock,
  SigmaStatus,
  VolatilityBlock,
} from '@midcurve/api-shared';

interface LvrCoveragePillProps {
  pool: PoolSearchResultItem;
}

const BAND_CLASS: Record<CoverageBand, string> = {
  deep_red: 'bg-red-700',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  deep_green: 'bg-green-700',
  insufficient_data: 'bg-gray-500',
};

function formatCoverage(coverage: number | null): string {
  if (coverage === null) return 'n/a';
  if (coverage >= 5) return '>5×';
  const rounded = coverage.toFixed(1);
  if (rounded === '5.0') return '>5×';
  return `${rounded}×`;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatio(value: number | null): string {
  if (value === null) return 'n/a';
  return value.toFixed(2);
}

/**
 * Resolve the human-readable reason for an `insufficient_data` band.
 * Priority order matches RFC-0002 §"Tooltip on hover".
 */
function resolveInsufficientDataReason(
  pool: PoolSearchResultItem,
  volatility: VolatilityBlock
): string {
  const t0Status: SigmaStatus = volatility.token0.sigma365d.status;
  const t1Status: SigmaStatus = volatility.token1.sigma365d.status;
  const pairStatus: SigmaStatus = volatility.pair.sigma365d.status;

  if (t0Status === 'token_not_listed') {
    return `${pool.token0.symbol} not listed on CoinGecko`;
  }
  if (t1Status === 'token_not_listed') {
    return `${pool.token1.symbol} not listed on CoinGecko`;
  }

  if (
    t0Status === 'insufficient_history' ||
    t1Status === 'insufficient_history' ||
    pairStatus === 'insufficient_history'
  ) {
    return 'Pool or token too young for σ calculation';
  }

  if (
    t0Status === 'fetch_failed' ||
    t1Status === 'fetch_failed' ||
    pairStatus === 'fetch_failed'
  ) {
    return 'Volatility data temporarily unavailable — try again later';
  }

  return 'LVR coverage cannot be computed for this pool';
}

export function LvrCoveragePill({ pool }: LvrCoveragePillProps) {
  const sigmaFilter: SigmaFilterBlock = pool.metrics.sigmaFilter;
  const volatility: VolatilityBlock = pool.metrics.volatility;

  const band: CoverageBand = sigmaFilter.coverageBand;
  const coverage = sigmaFilter.coverageLongTerm;
  const isInsufficient = band === 'insufficient_data';

  const colorClass = BAND_CLASS[band];
  const text = formatCoverage(coverage);

  return (
    <div className="relative inline-block group">
      <span
        className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium text-white cursor-help ${colorClass}`}
      >
        {text}
      </span>
      <div
        className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block bg-slate-800/95 border border-slate-700 rounded-lg p-3 shadow-xl backdrop-blur-sm whitespace-nowrap text-left"
        role="tooltip"
      >
        {isInsufficient ? (
          <p className="text-slate-300 text-sm">
            {resolveInsufficientDataReason(pool, volatility)}
          </p>
        ) : (
          <>
            <p className="text-slate-300 text-sm">
              <span className="text-slate-400">LVR threshold (σ²/8, 365d):</span>{' '}
              {formatPercent(sigmaFilter.sigmaSqOver8_365d)}
            </p>
            <p className="text-slate-300 text-sm">
              <span className="text-slate-400">Coverage ratio:</span>{' '}
              {formatRatio(coverage)}
            </p>
            <p className="text-slate-300 text-sm">
              <span className="text-slate-400">Fee APR (7d):</span>{' '}
              {formatPercent(sigmaFilter.feeApr)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
