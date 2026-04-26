import { describe, expect, it } from 'vitest';
import { formatPool } from './formatters.js';

/**
 * Fixture shapes mirror the API's `serializeUniswapV3Pool` output (see
 * apps/midcurve-api/src/lib/serializers.ts) and `buildPoolMetricsBlock`
 * (apps/midcurve-api/src/lib/pool-metrics-block.ts) — what `apiClient.get`
 * unwraps from the `{success, data, meta}` envelope and hands to formatPool.
 */

type PoolDetail = Parameters<typeof formatPool>[0];

const WETH = {
  symbol: 'WETH',
  decimals: 18,
  config: {
    address: '0x4200000000000000000000000000000000000006',
    chainId: 8453,
  },
};

const USDC = {
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
  },
};

function basePool(): PoolDetail {
  return {
    pool: {
      protocol: 'uniswapv3',
      feeBps: 500,
      token0: WETH,
      token1: USDC,
      config: {
        chainId: 8453,
        address: '0xd0b53D9277642d899DF5C87A3966A349A798F224',
        tickSpacing: 10,
      },
      state: {
        sqrtPriceX96: '1234567890',
        liquidity: '987654321',
        currentTick: 200000,
      },
    },
  };
}

const HEALTHY_METRICS: NonNullable<PoolDetail['metrics']> = {
  tvlUSD: '12500000.5',
  volume24hUSD: '50000000',
  fees24hUSD: '25000',
  fees7dUSD: '175000',
  volume7dAvgUSD: '50000000',
  fees7dAvgUSD: '25000',
  apr7d: 25.12,
  feeApr24h: 0.2512,
  feeApr7dAvg: 0.2512,
  feeAprPrimary: 0.2512,
  feeAprSource: '7d_avg',
  volatility: {
    token0: {
      ref: 'erc20/8453/0x4200000000000000000000000000000000000006',
      sigma60d: { status: 'ok', value: 0.7152, nReturns: 60 },
      sigma365d: { status: 'ok', value: 0.7152, nReturns: 365 },
    },
    token1: {
      ref: 'erc20/8453/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      sigma60d: { status: 'ok', value: 0.001, nReturns: 60 },
      sigma365d: { status: 'ok', value: 0.001, nReturns: 365 },
    },
    pair: {
      sigma60d: { status: 'ok', value: 0.7150, sigmaSqOver8: 0.0639, nReturns: 60 },
      sigma365d: { status: 'ok', value: 0.7150, sigmaSqOver8: 0.0639, nReturns: 365 },
    },
    velocity: 1.0,
    pivotCurrency: 'usd',
    computedAt: '2026-04-26T00:00:00.000Z',
  },
  sigmaFilter: {
    feeApr: 0.2512,
    sigmaSqOver8_365d: 0.0639,
    sigmaSqOver8_60d: 0.0639,
    marginLongTerm: 0.1873,
    marginShortTerm: 0.1873,
    verdictLongTerm: 'PASS',
    verdictShortTerm: 'PASS',
    verdictAgreement: 'AGREE',
  },
};

describe('formatPool', () => {
  it('formats a pool without metrics (metrics: null path)', () => {
    const out = formatPool(basePool());
    expect(out.metrics).toBeNull();
    expect(out.feeData).toBeNull();
    expect(out.pair).toBe('WETH/USDC');
    expect(out.feeTier).toBe('0.05%');
  });

  it('formats a healthy pool with full metrics', () => {
    const detail = { ...basePool(), metrics: HEALTHY_METRICS };
    const out = formatPool(detail);
    expect(out.metrics).not.toBeNull();
    const m = out.metrics as Record<string, unknown>;
    expect(m.apr7d).toBe('25.12%');
    expect(m.feeApr7dAvg).toBe('25.12%');
    const sigmaFilter = m.sigmaFilter as Record<string, unknown>;
    expect(sigmaFilter.verdictLongTerm).toBe('PASS');
    expect(sigmaFilter.marginLongTerm).toBe('+18.7%');
    const volatility = m.volatility as Record<string, unknown>;
    expect(volatility.velocity).toBe('1.000');
  });

  it('does not crash when velocity is undefined (regression: issue #43)', () => {
    const metrics = structuredClone(HEALTHY_METRICS);
    (metrics.volatility as { velocity?: unknown }).velocity = undefined;
    const detail = { ...basePool(), metrics };
    const out = formatPool(detail);
    const volatility = (out.metrics as Record<string, unknown>).volatility as Record<
      string,
      unknown
    >;
    expect(volatility.velocity).toBeNull();
  });

  it('does not crash when apr7d is null', () => {
    const metrics = structuredClone(HEALTHY_METRICS) as PoolDetail['metrics'] & {
      apr7d: number | null;
    };
    metrics.apr7d = null;
    const detail = { ...basePool(), metrics };
    const out = formatPool(detail);
    expect((out.metrics as Record<string, unknown>).apr7d).toBeNull();
  });

  it('does not crash when sigma blocks are status:insufficient_history (no value field)', () => {
    const metrics = structuredClone(HEALTHY_METRICS);
    const vIn = metrics.volatility!;
    vIn.token0.sigma60d = { status: 'insufficient_history' };
    vIn.token0.sigma365d = { status: 'insufficient_history' };
    vIn.pair.sigma60d = { status: 'insufficient_history' };
    vIn.pair.sigma365d = { status: 'insufficient_history' };
    vIn.velocity = null;
    metrics.sigmaFilter = {
      feeApr: 0.2512,
      sigmaSqOver8_365d: null,
      sigmaSqOver8_60d: null,
      marginLongTerm: null,
      marginShortTerm: null,
      verdictLongTerm: 'INSUFFICIENT_DATA',
      verdictShortTerm: 'INSUFFICIENT_DATA',
      verdictAgreement: 'INSUFFICIENT_DATA',
    };
    const detail = { ...basePool(), metrics };
    const out = formatPool(detail);
    const m = out.metrics as Record<string, unknown>;
    const vOut = m.volatility as Record<string, unknown>;
    expect(vOut.velocity).toBeNull();
    const token0 = vOut.token0 as Record<string, unknown>;
    const sigma60d = token0.sigma60d as Record<string, unknown>;
    expect(sigma60d.status).toBe('insufficient_history');
    expect(sigma60d.value).toBeNull();
  });

  it('does not crash when metrics.volatility is missing entirely', () => {
    // Reproducer for "Cannot read properties of undefined (reading 'token0')":
    // some upstream path may omit the volatility block from the metrics envelope.
    const metrics = structuredClone(HEALTHY_METRICS) as Partial<typeof HEALTHY_METRICS>;
    delete metrics.volatility;
    const detail = { ...basePool(), metrics: metrics as NonNullable<PoolDetail['metrics']> };
    const out = formatPool(detail);
    const m = out.metrics as Record<string, unknown>;
    expect(m.volatility).toBeNull();
  });

  it('does not crash when metrics.sigmaFilter is missing entirely', () => {
    const metrics = structuredClone(HEALTHY_METRICS) as Partial<typeof HEALTHY_METRICS>;
    delete metrics.sigmaFilter;
    const detail = { ...basePool(), metrics: metrics as NonNullable<PoolDetail['metrics']> };
    const out = formatPool(detail);
    const m = out.metrics as Record<string, unknown>;
    expect(m.sigmaFilter).toBeNull();
  });
});
