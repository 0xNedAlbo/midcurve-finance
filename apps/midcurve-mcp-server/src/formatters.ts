/**
 * Output mappers — translate raw API responses into compact, human-readable
 * shapes that Claude can reason over efficiently. Bigint-as-string fields
 * become formatted display strings; opaque CUIDs and userIds are dropped.
 */

import {
  formatDateTime,
  formatPercentage,
  formatRelativeTime,
  formatReportingAmount,
  formatTokenAmount,
  formatUSDValue,
  tickToPrice,
  type SerializedConversionSummary,
  type SerializedRebalancingSegment,
} from '@midcurve/shared';
import type {
  AprPeriodData,
  AprPeriodsResponse,
  PairSigmaResult,
  PoolSearchResultItem,
  PositionAccountingResponse,
  SerializedCloseOrder,
  SigmaFilterBlock,
  VolatilityBlock,
} from '@midcurve/api-shared';
import type { PositionContext } from './lib/position-context.js';

function pickAddress(obj: { address?: string | null } | null | undefined): string | null {
  return obj?.address ?? null;
}

function timestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return `${formatDateTime(iso)} (${formatRelativeTime(iso)})`;
}

function pct(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return formatPercentage(value);
}

/**
 * Format a quote-token bigint amount paired with a token symbol.
 * Used for current value, cost basis, PnL etc. on positions where the quote
 * token is known and the API returns the value scaled to that token's decimals.
 */
function quoteAmount(value: string | null | undefined, symbol: string, decimals: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  // Spec: zero must display with 2 fractional digits ("0.00 USDC"), not "0 USDC".
  if (BigInt(value) === 0n) return `0.00 ${symbol}`;
  return formatTokenAmount(value, symbol, decimals);
}

/**
 * Raw pool/token summary as returned by the API when `include=pool` is set.
 * token0/token1 follow canonical pool ordering — base/quote pivot is done
 * inside {@link formatPoolSummary} via `isToken0Quote`.
 */
interface PoolSummaryRaw {
  chainId: number;
  poolAddress: string;
  feeBps: number;
  isToken0Quote: boolean;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
}

/**
 * Format a pool summary into the canonical MCP shape used by both
 * `list_positions` items and `get_position.pool`. Uniswap's `feeBps` value
 * is denominated in hundredths of a basis point (1/1,000,000), so the
 * percentage divisor is 10_000 — not 100.
 */
function formatPoolSummary(pool: PoolSummaryRaw): Record<string, unknown> {
  const baseToken = pool.isToken0Quote ? pool.token1 : pool.token0;
  const quoteToken = pool.isToken0Quote ? pool.token0 : pool.token1;
  return {
    chainId: pool.chainId,
    poolAddress: pool.poolAddress,
    pair: `${baseToken.symbol}/${quoteToken.symbol}`,
    feeBps: pool.feeBps,
    feeTier: `${(pool.feeBps / 10_000).toFixed(2)}%`,
    baseToken: { address: baseToken.address, symbol: baseToken.symbol, decimals: baseToken.decimals },
    quoteToken: { address: quoteToken.address, symbol: quoteToken.symbol, decimals: quoteToken.decimals },
  };
}

interface PositionListItemRaw {
  positionHash: string;
  protocol: string;
  type: string;
  currentValue: string;
  costBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  collectedYield: string;
  unclaimedYield: string;
  totalApr: number | null;
  baseApr: number | null;
  rewardApr: number | null;
  priceRangeLower: string;
  priceRangeUpper: string;
  positionOpenedAt: string;
  isArchived: boolean;
  archivedAt: string | null;
  pool?: PoolSummaryRaw;
}

export function formatPositionListItem(item: PositionListItemRaw): Record<string, unknown> {
  // priceRange + money fields are quote-denominated bigints scaled to quote-token
  // decimals. The pool summary supplies the quote token for humanizing; if the
  // pool is missing, raw companions still carry the canonical bigint string and
  // display fields are null.
  const quoteToken = item.pool
    ? item.pool.isToken0Quote ? item.pool.token0 : item.pool.token1
    : null;
  const money = (raw: string): string | null =>
    quoteToken ? quoteAmount(raw, quoteToken.symbol, quoteToken.decimals) : null;

  return {
    positionHash: item.positionHash,
    protocol: item.protocol,
    type: item.type,
    pool: item.pool ? formatPoolSummary(item.pool) : null,
    currentValue: money(item.currentValue),
    currentValueRaw: item.currentValue,
    costBasis: money(item.costBasis),
    costBasisRaw: item.costBasis,
    realizedPnl: money(item.realizedPnl),
    realizedPnlRaw: item.realizedPnl,
    unrealizedPnl: money(item.unrealizedPnl),
    unrealizedPnlRaw: item.unrealizedPnl,
    collectedYield: money(item.collectedYield),
    collectedYieldRaw: item.collectedYield,
    unclaimedYield: money(item.unclaimedYield),
    unclaimedYieldRaw: item.unclaimedYield,
    apr: {
      total: pct(item.totalApr),
      base: pct(item.baseApr),
      reward: pct(item.rewardApr),
    },
    priceRange: {
      lower: money(item.priceRangeLower),
      lowerRaw: item.priceRangeLower,
      upper: money(item.priceRangeUpper),
      upperRaw: item.priceRangeUpper,
    },
    openedAt: timestamp(item.positionOpenedAt),
    isArchived: item.isArchived,
    archivedAt: item.isArchived ? timestamp(item.archivedAt) : null,
  };
}

interface UniswapV3PositionRaw {
  positionHash: string;
  protocol: string;
  type: string;
  isToken0Quote: boolean;
  // Pool comes back via serializeUniswapV3Pool: token addresses are nested inside
  // each token's `config`, and pool state carries the live currentTick used to
  // determine in-range status.
  pool: {
    protocol: string;
    feeBps: number;
    token0: { symbol: string; decimals: number; config?: { address?: string; chainId?: number } };
    token1: { symbol: string; decimals: number; config?: { address?: string; chainId?: number } };
    config?: { chainId?: number; address?: string };
    state?: { currentTick?: number; [k: string]: unknown };
  };
  currentValue: string;
  costBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  collectedYield: string;
  unclaimedYield: string;
  totalApr: number | null;
  baseApr: number | null;
  rewardApr: number | null;
  priceRangeLower?: string;
  priceRangeUpper?: string;
  currentPrice?: string;
  inRange?: boolean;
  positionOpenedAt: string;
  isArchived: boolean;
  archivedAt: string | null;
  ownerWallet: string | null;
  // Position config carries `poolAddress` and tick bounds for both protocols
  // (NFT and vault). Token addresses live here on vault positions only —
  // for NFTs, read them from pool.token0.config.address.
  config?: { poolAddress?: string; tickLower?: number; tickUpper?: number; [k: string]: unknown };
  state?: { currentTick?: number; [k: string]: unknown };
}

export function formatPosition(p: UniswapV3PositionRaw): Record<string, unknown> {
  // Flatten token shape (API nests address under token.config.address) so the
  // shared formatPoolSummary sees the same { address, symbol, decimals } shape
  // it gets from list_positions.
  const token0 = {
    address: p.pool.token0.config?.address ?? '',
    symbol: p.pool.token0.symbol,
    decimals: p.pool.token0.decimals,
  };
  const token1 = {
    address: p.pool.token1.config?.address ?? '',
    symbol: p.pool.token1.symbol,
    decimals: p.pool.token1.decimals,
  };
  const quoteToken = p.isToken0Quote ? token0 : token1;
  const money = (raw: string | null | undefined): string | null =>
    quoteAmount(raw, quoteToken.symbol, quoteToken.decimals);

  // poolAddress is uniformly available on the position's own config for both
  // NFT and vault positions; the pool's config exposes it as `address`.
  const poolAddress = p.config?.poolAddress ?? p.pool.config?.address ?? '';

  // Compute inRange deterministically from ticks. currentTick lives on the
  // pool's state for both protocols (NFT positions don't carry it on their
  // own state). Fall back to the API-provided flag if any input is missing.
  const tickLower = p.config?.tickLower;
  const tickUpper = p.config?.tickUpper;
  const currentTick = p.pool.state?.currentTick ?? p.state?.currentTick;
  const inRange =
    typeof tickLower === 'number' &&
    typeof tickUpper === 'number' &&
    typeof currentTick === 'number'
      ? currentTick >= tickLower && currentTick <= tickUpper
      : (p.inRange ?? null);

  return {
    positionHash: p.positionHash,
    protocol: p.protocol,
    type: p.type,
    pool: formatPoolSummary({
      chainId: (p.pool.config?.chainId ?? 0) as number,
      poolAddress,
      feeBps: p.pool.feeBps,
      isToken0Quote: p.isToken0Quote,
      token0,
      token1,
    }),
    currentValue: money(p.currentValue),
    currentValueRaw: p.currentValue,
    costBasis: money(p.costBasis),
    costBasisRaw: p.costBasis,
    realizedPnl: money(p.realizedPnl),
    realizedPnlRaw: p.realizedPnl,
    unrealizedPnl: money(p.unrealizedPnl),
    unrealizedPnlRaw: p.unrealizedPnl,
    collectedYield: money(p.collectedYield),
    collectedYieldRaw: p.collectedYield,
    unclaimedYield: money(p.unclaimedYield),
    unclaimedYieldRaw: p.unclaimedYield,
    apr: { total: pct(p.totalApr), base: pct(p.baseApr), reward: pct(p.rewardApr) },
    priceRange: {
      lower: money(p.priceRangeLower),
      lowerRaw: p.priceRangeLower ?? null,
      upper: money(p.priceRangeUpper),
      upperRaw: p.priceRangeUpper ?? null,
      current: money(p.currentPrice),
      currentRaw: p.currentPrice ?? null,
      inRange,
    },
    ownerWallet: p.ownerWallet,
    openedAt: timestamp(p.positionOpenedAt),
    isArchived: p.isArchived,
    archivedAt: p.isArchived ? timestamp(p.archivedAt) : null,
    rawConfig: p.config,
    rawState: p.state,
  };
}

interface PnlPositionRaw {
  positionRef: string;
  nftId: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  realizedFromFxEffect: string;
  netPnl: string;
}

interface PnlInstrumentRaw {
  instrumentRef: string;
  poolSymbol: string;
  protocol: string;
  chainId: number;
  feeTier: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  realizedFromFxEffect: string;
  netPnl: string;
  positions: PnlPositionRaw[];
}

interface PnlResponseRaw {
  period: string;
  startDate: string;
  endDate: string;
  reportingCurrency: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  realizedFromFxEffect: string;
  netPnl: string;
  instruments: PnlInstrumentRaw[];
}

export function formatPnl(pnl: PnlResponseRaw): Record<string, unknown> {
  const cur = pnl.reportingCurrency;
  return {
    period: pnl.period,
    startDate: timestamp(pnl.startDate),
    endDate: timestamp(pnl.endDate),
    reportingCurrency: cur,
    portfolio: {
      netPnl: formatReportingAmount(pnl.netPnl, cur),
      netPnlRaw: pnl.netPnl,
      realizedFromWithdrawals: formatReportingAmount(pnl.realizedFromWithdrawals, cur),
      realizedFromWithdrawalsRaw: pnl.realizedFromWithdrawals,
      realizedFromCollectedFees: formatReportingAmount(pnl.realizedFromCollectedFees, cur),
      realizedFromCollectedFeesRaw: pnl.realizedFromCollectedFees,
      realizedFromFxEffect: formatReportingAmount(pnl.realizedFromFxEffect, cur),
      realizedFromFxEffectRaw: pnl.realizedFromFxEffect,
    },
    instruments: pnl.instruments.map((inst) => ({
      instrumentRef: inst.instrumentRef,
      poolSymbol: inst.poolSymbol,
      protocol: inst.protocol,
      chainId: inst.chainId,
      feeTier: inst.feeTier,
      netPnl: formatReportingAmount(inst.netPnl, cur),
      netPnlRaw: inst.netPnl,
      realizedFromWithdrawals: formatReportingAmount(inst.realizedFromWithdrawals, cur),
      realizedFromWithdrawalsRaw: inst.realizedFromWithdrawals,
      realizedFromCollectedFees: formatReportingAmount(inst.realizedFromCollectedFees, cur),
      realizedFromCollectedFeesRaw: inst.realizedFromCollectedFees,
      realizedFromFxEffect: formatReportingAmount(inst.realizedFromFxEffect, cur),
      realizedFromFxEffectRaw: inst.realizedFromFxEffect,
      positions: inst.positions.map((pos) => ({
        positionRef: pos.positionRef,
        nftId: pos.nftId,
        netPnl: formatReportingAmount(pos.netPnl, cur),
        netPnlRaw: pos.netPnl,
        realizedFromWithdrawals: formatReportingAmount(pos.realizedFromWithdrawals, cur),
        realizedFromWithdrawalsRaw: pos.realizedFromWithdrawals,
        realizedFromCollectedFees: formatReportingAmount(pos.realizedFromCollectedFees, cur),
        realizedFromCollectedFeesRaw: pos.realizedFromCollectedFees,
        realizedFromFxEffect: formatReportingAmount(pos.realizedFromFxEffect, cur),
        realizedFromFxEffectRaw: pos.realizedFromFxEffect,
      })),
    })),
  };
}

/**
 * Pool detail response from `GET /api/v1/pools/uniswapv3/:chainId/:address`.
 * Matches the wire shape: serialized pool nested under `pool`, with optional
 * `metrics` (PoolMetricsBlock per PRD-pool-sigma-filter) and `feeData` siblings.
 */
interface PoolDetailRaw {
  // TODO(#52): replace this hand-written subset with the canonical pool wire
  // shape once #52 introduces a true plain-object wire type in
  // @midcurve/api-shared. The canonical `GetUniswapV3PoolData['pool']` is the
  // UniswapV3Pool class type (Date fields, methods) — not what's actually on
  // the wire. The subset below visibly advertises that gap.
  pool: {
    protocol: string;
    feeBps: number;
    token0: { symbol: string; decimals: number; config: { address: string; chainId: number } };
    token1: { symbol: string; decimals: number; config: { address: string; chainId: number } };
    config: { chainId: number; address: string; tickSpacing: number };
    state: Record<string, unknown>;
  };
  metrics?: {
    tvlUSD: string;
    volume24hUSD: string;
    fees24hUSD: string;
    fees7dUSD: string;
    volume7dAvgUSD: string;
    fees7dAvgUSD: string;
    apr7d: number | null;
    feeApr24h: number | null;
    feeApr7dAvg: number | null;
    feeAprPrimary: number | null;
    feeAprSource: '24h' | '7d_avg' | 'unavailable';
    volatility?: VolatilityBlock;
    sigmaFilter?: SigmaFilterBlock;
  };
  feeData?: Record<string, unknown>;
  /**
   * Optional echo of the request's `isToken0Quote` query param (PRD-issue-#45).
   * When present, surfaced unchanged on the formatted output so consumers can
   * pivot to base/quote orientation. Pool itself remains role-agnostic.
   */
  userProvidedInfo?: { isToken0Quote: boolean };
}

/**
 * Format a raw rate (e.g. 0.2512) as a percentage string ("25.1%").
 * Returns null when input is null. Used for fee-APR, σ, σ²/8, margin.
 */
function fmtRate(rate: number | null | undefined, decimals = 1): string | null {
  if (rate === null || rate === undefined) return null;
  return formatPercentage(rate * 100, decimals);
}

/** Same as fmtRate but always emits a leading sign — used for margins. */
function fmtSignedRate(rate: number | null | undefined, decimals = 1): string | null {
  if (rate === null || rate === undefined) return null;
  const display = formatPercentage(rate * 100, decimals);
  return rate >= 0 ? `+${display}` : display;
}

/**
 * Per-token σ-vs-USD block. Per PRD §3.3, single-token σ has no LVR
 * interpretation, so `sigmaSqOver8` is never present on the wire — emit
 * `{status, value, nReturns}` only.
 */
function formatTokenSigmaResult(r: PairSigmaResult): Record<string, unknown> {
  return {
    status: r.status,
    value: fmtRate(r.value),
    nReturns: r.nReturns ?? null,
  };
}

/**
 * Pair σ block. Carries `sigmaSqOver8` (the LVR rate of the synthetic
 * cross-pair) which feeds the σ-filter verdict.
 */
function formatPairSigmaResult(r: PairSigmaResult): Record<string, unknown> {
  return {
    status: r.status,
    value: fmtRate(r.value),
    sigmaSqOver8: fmtRate(r.sigmaSqOver8),
    nReturns: r.nReturns ?? null,
  };
}

function formatVolatility(v: VolatilityBlock): Record<string, unknown> {
  return {
    token0: {
      ref: v.token0.ref,
      sigma60d: formatTokenSigmaResult(v.token0.sigma60d),
      sigma365d: formatTokenSigmaResult(v.token0.sigma365d),
    },
    token1: {
      ref: v.token1.ref,
      sigma60d: formatTokenSigmaResult(v.token1.sigma60d),
      sigma365d: formatTokenSigmaResult(v.token1.sigma365d),
    },
    pair: {
      sigma60d: formatPairSigmaResult(v.pair.sigma60d),
      sigma365d: formatPairSigmaResult(v.pair.sigma365d),
    },
    velocity:
      v.velocity !== null && v.velocity !== undefined ? v.velocity.toFixed(3) : null,
    pivotCurrency: v.pivotCurrency,
    computedAt: v.computedAt,
  };
}

function formatSigmaFilter(s: SigmaFilterBlock): Record<string, unknown> {
  return {
    feeApr: fmtRate(s.feeApr),
    sigmaSqOver8_365d: fmtRate(s.sigmaSqOver8_365d),
    sigmaSqOver8_60d: fmtRate(s.sigmaSqOver8_60d),
    marginLongTerm: fmtSignedRate(s.marginLongTerm),
    marginShortTerm: fmtSignedRate(s.marginShortTerm),
    verdictLongTerm: s.verdictLongTerm,
    verdictShortTerm: s.verdictShortTerm,
    verdictAgreement: s.verdictAgreement,
    coverageLongTerm:
      s.coverageLongTerm !== null && s.coverageLongTerm !== undefined
        ? s.coverageLongTerm.toFixed(3)
        : null,
    coverageBand: s.coverageBand,
  };
}

/**
 * Standalone pool detail uses the canonical pool ordering (`token0`/`token1`)
 * — outside a position context there is no base/quote pivot. See convention
 * §3.1 ("Embedded pool summary vs standalone pool detail").
 */
export function formatPool(detail: PoolDetailRaw): Record<string, unknown> {
  const { pool, metrics, feeData, userProvidedInfo } = detail;
  const token0 = {
    address: pool.token0.config.address,
    symbol: pool.token0.symbol,
    decimals: pool.token0.decimals,
  };
  const token1 = {
    address: pool.token1.config.address,
    symbol: pool.token1.symbol,
    decimals: pool.token1.decimals,
  };

  // Subgraph metrics arrive as USD float strings. Per convention §3.2/§3.3,
  // dual-emit the raw float string alongside the compact display.
  const fmtUsd = (raw: string | undefined): string | null =>
    raw ? formatUSDValue(raw) : null;

  return {
    chainId: pool.config.chainId,
    poolAddress: pool.config.address,
    protocol: pool.protocol,
    pair: `${token0.symbol}/${token1.symbol}`,
    feeBps: pool.feeBps,
    feeTier: `${(pool.feeBps / 10_000).toFixed(2)}%`,
    tickSpacing: pool.config.tickSpacing,
    token0,
    token1,
    metrics: metrics
      ? {
          // Money fields — dual-emit per convention §3.2 (display + raw).
          tvl: fmtUsd(metrics.tvlUSD),
          tvlRaw: metrics.tvlUSD,
          volume24h: fmtUsd(metrics.volume24hUSD),
          volume24hRaw: metrics.volume24hUSD,
          fees24h: fmtUsd(metrics.fees24hUSD),
          fees24hRaw: metrics.fees24hUSD,
          fees7d: fmtUsd(metrics.fees7dUSD),
          fees7dRaw: metrics.fees7dUSD,
          volume7dAvg: fmtUsd(metrics.volume7dAvgUSD),
          volume7dAvgRaw: metrics.volume7dAvgUSD,
          fees7dAvg: fmtUsd(metrics.fees7dAvgUSD),
          fees7dAvgRaw: metrics.fees7dAvgUSD,
          // Percentages — single-emit humanized (convention §73).
          // `apr7d` arrives as a percentage already (e.g. 25.12).
          apr7d:
            metrics.apr7d !== null && metrics.apr7d !== undefined
              ? formatPercentage(metrics.apr7d, 2)
              : null,
          // Fee-APR raw rates → percentage strings.
          feeApr24h: fmtRate(metrics.feeApr24h, 2),
          feeApr7dAvg: fmtRate(metrics.feeApr7dAvg, 2),
          feeAprPrimary: fmtRate(metrics.feeAprPrimary, 2),
          feeAprSource: metrics.feeAprSource,
          // Volatility & σ-filter (PRD-pool-sigma-filter §3.3, §3.4). Both
          // blocks are optional at the wire boundary — older API responses or
          // failed enrichment paths can omit them; emit null rather than crash.
          volatility: metrics.volatility ? formatVolatility(metrics.volatility) : null,
          sigmaFilter: metrics.sigmaFilter ? formatSigmaFilter(metrics.sigmaFilter) : null,
        }
      : null,
    feeData: feeData ?? null,
    ...(userProvidedInfo && { userProvidedInfo }),
    state: pool.state,
  };
}

// =============================================================================
// Pool Search Result (POST /api/v1/pools/uniswapv3/search)
// =============================================================================

/**
 * Format a single pool search result for MCP output. Mirrors `formatPool`'s
 * shape (canonical token0/token1, dual-emitted USD fields, humanized
 * percentages, σ-filter / volatility blocks) and adds search-specific fields
 * (`isFavorite`, `userProvidedInfo`).
 */
export function formatPoolSearchResult(
  result: PoolSearchResultItem
): Record<string, unknown> {
  const fmtUsd = (raw: string | undefined): string | null =>
    raw ? formatUSDValue(raw) : null;
  const m = result.metrics;
  return {
    chainId: result.chainId,
    chainName: result.chainName,
    poolAddress: result.poolAddress,
    pair: `${result.token0.symbol}/${result.token1.symbol}`,
    feeBps: result.feeTier,
    feeTier: `${(result.feeTier / 10_000).toFixed(2)}%`,
    token0: result.token0,
    token1: result.token1,
    metrics: {
      tvl: fmtUsd(m.tvlUSD),
      tvlRaw: m.tvlUSD,
      volume24h: fmtUsd(m.volume24hUSD),
      volume24hRaw: m.volume24hUSD,
      fees24h: fmtUsd(m.fees24hUSD),
      fees24hRaw: m.fees24hUSD,
      fees7d: fmtUsd(m.fees7dUSD),
      fees7dRaw: m.fees7dUSD,
      volume7dAvg: fmtUsd(m.volume7dAvgUSD),
      volume7dAvgRaw: m.volume7dAvgUSD,
      fees7dAvg: fmtUsd(m.fees7dAvgUSD),
      fees7dAvgRaw: m.fees7dAvgUSD,
      apr7d:
        m.apr7d !== null && m.apr7d !== undefined
          ? formatPercentage(m.apr7d, 2)
          : null,
      feeApr24h: fmtRate(m.feeApr24h ?? null, 2),
      feeApr7dAvg: fmtRate(m.feeApr7dAvg ?? null, 2),
      feeAprPrimary: fmtRate(m.feeAprPrimary ?? null, 2),
      feeAprSource: m.feeAprSource ?? 'unavailable',
      volatility: m.volatility ? formatVolatility(m.volatility) : null,
      sigmaFilter: m.sigmaFilter ? formatSigmaFilter(m.sigmaFilter) : null,
    },
    isFavorite: result.isFavorite ?? false,
    ...(result.userProvidedInfo && { userProvidedInfo: result.userProvidedInfo }),
  };
}

export function formatUser(user: { id: string; address: string; name?: string | null; reportingCurrency?: string; createdAt?: string }): Record<string, unknown> {
  return {
    address: user.address,
    name: user.name ?? null,
    reportingCurrency: user.reportingCurrency ?? null,
    memberSince: timestamp(user.createdAt),
    userId: user.id,
  };
}

// =============================================================================
// Conversion Summary
// =============================================================================

/**
 * Average prices are stored as "quote raw units per one whole base unit" —
 * i.e. the raw quote amount (already in quote-token decimals) multiplied by
 * 10^baseDecimals and then divided by the raw base amount. To get a
 * human-readable price, scale by the quote-token decimals.
 */
function formatAvgPrice(
  raw: string,
  quoteDecimals: number,
  quoteSymbol: string,
): string | null {
  const n = BigInt(raw);
  if (n === 0n) return null;
  return formatTokenAmount(raw, quoteSymbol, quoteDecimals);
}

function formatSegment(
  segment: SerializedRebalancingSegment,
  summary: SerializedConversionSummary,
): Record<string, unknown> {
  const deltaBase = BigInt(segment.deltaBase);
  const direction = deltaBase < 0n ? 'sold' : deltaBase > 0n ? 'bought' : 'neutral';
  const absBase = deltaBase < 0n ? -deltaBase : deltaBase;
  const deltaQuote = BigInt(segment.deltaQuote);
  const absQuote = deltaQuote < 0n ? -deltaQuote : deltaQuote;
  const absBaseStr = absBase.toString();
  const absQuoteStr = absQuote.toString();
  const feesNonZero = segment.feesEarned !== '0';

  return {
    period: {
      start: timestamp(segment.startTimestamp),
      end: segment.isTrailing ? 'now' : timestamp(segment.endTimestamp),
    },
    direction,
    baseAmount: formatTokenAmount(absBaseStr, summary.baseTokenSymbol, summary.baseTokenDecimals),
    baseAmountRaw: absBaseStr,
    quoteAmount: formatTokenAmount(absQuoteStr, summary.quoteTokenSymbol, summary.quoteTokenDecimals),
    quoteAmountRaw: absQuoteStr,
    avgPrice: formatAvgPrice(segment.avgPrice, summary.quoteTokenDecimals, summary.quoteTokenSymbol),
    avgPriceRaw: segment.avgPrice,
    feesEarned: feesNonZero
      ? formatTokenAmount(segment.feesEarned, summary.quoteTokenSymbol, summary.quoteTokenDecimals)
      : null,
    feesEarnedRaw: feesNonZero ? segment.feesEarned : null,
  };
}

export function formatConversionSummary(
  summary: SerializedConversionSummary,
): Record<string, unknown> {
  const { baseTokenSymbol, quoteTokenSymbol, baseTokenDecimals, quoteTokenDecimals } = summary;

  const netRebalancingBase = BigInt(summary.netRebalancingBase);
  const netDirection =
    netRebalancingBase < 0n ? 'sold' : netRebalancingBase > 0n ? 'bought' : 'neutral';
  const absNetBase = netRebalancingBase < 0n ? -netRebalancingBase : netRebalancingBase;
  const netRebalancingQuote = BigInt(summary.netRebalancingQuote);
  const absNetQuote = netRebalancingQuote < 0n ? -netRebalancingQuote : netRebalancingQuote;
  const absNetBaseStr = absNetBase.toString();
  const absNetQuoteStr = absNetQuote.toString();

  const baseAmt = (raw: string) => formatTokenAmount(raw, baseTokenSymbol, baseTokenDecimals);
  const quoteAmt = (raw: string) => formatTokenAmount(raw, quoteTokenSymbol, quoteTokenDecimals);
  const price = (raw: string) => formatAvgPrice(raw, quoteTokenDecimals, quoteTokenSymbol);

  const ammBoughtNonZero = summary.ammBoughtBase !== '0';
  const ammSoldNonZero = summary.ammSoldBase !== '0';
  const premiumNonZero = summary.totalPremium !== '0';

  return {
    baseToken: { symbol: baseTokenSymbol, decimals: baseTokenDecimals },
    quoteToken: { symbol: quoteTokenSymbol, decimals: quoteTokenDecimals },
    isClosed: summary.isClosed,
    daysActive: summary.daysActive,
    deposits: {
      base: baseAmt(summary.netDepositBase),
      baseRaw: summary.netDepositBase,
      quote: quoteAmt(summary.netDepositQuote),
      quoteRaw: summary.netDepositQuote,
      avgPrice: price(summary.netDepositAvgPrice),
      avgPriceRaw: summary.netDepositAvgPrice,
    },
    withdrawn: {
      base: baseAmt(summary.withdrawnBase),
      baseRaw: summary.withdrawnBase,
      quote: quoteAmt(summary.withdrawnQuote),
      quoteRaw: summary.withdrawnQuote,
    },
    currentHoldings: {
      base: baseAmt(summary.currentBase),
      baseRaw: summary.currentBase,
      quote: quoteAmt(summary.currentQuote),
      quoteRaw: summary.currentQuote,
      spotPrice: price(summary.currentSpotPrice),
      spotPriceRaw: summary.currentSpotPrice,
    },
    netConversion: {
      direction: netDirection,
      baseAmount: baseAmt(absNetBaseStr),
      baseAmountRaw: absNetBaseStr,
      quoteAmount: quoteAmt(absNetQuoteStr),
      quoteAmountRaw: absNetQuoteStr,
      avgExecutionPrice: price(summary.netRebalancingAvgPrice),
      avgExecutionPriceRaw: summary.netRebalancingAvgPrice,
    },
    ammBought: ammBoughtNonZero
      ? {
          base: baseAmt(summary.ammBoughtBase),
          baseRaw: summary.ammBoughtBase,
          avgPrice: price(summary.ammBoughtAvgPrice),
          avgPriceRaw: summary.ammBoughtAvgPrice,
        }
      : null,
    ammSold: ammSoldNonZero
      ? {
          base: baseAmt(summary.ammSoldBase),
          baseRaw: summary.ammSoldBase,
          avgPrice: price(summary.ammSoldAvgPrice),
          avgPriceRaw: summary.ammSoldAvgPrice,
        }
      : null,
    totalPremium: premiumNonZero ? quoteAmt(summary.totalPremium) : null,
    totalPremiumRaw: premiumNonZero ? summary.totalPremium : null,
    segments: summary.segments.map((s) => formatSegment(s, summary)),
  };
}

// =============================================================================
// Position Accounting
// =============================================================================

export function formatPositionAccounting(
  report: PositionAccountingResponse,
): Record<string, unknown> {
  const cur = report.reportingCurrency;
  const amount = (raw: string) => formatReportingAmount(raw, cur);

  const assets = report.balanceSheet.assets;
  const equity = report.balanceSheet.equity;
  const re = equity.retainedEarnings;
  const pnl = report.pnl;

  return {
    positionRef: report.positionRef,
    reportingCurrency: cur,
    balanceSheet: {
      assets: {
        lpPositionAtCost: amount(assets.lpPositionAtCost),
        lpPositionAtCostRaw: assets.lpPositionAtCost,
        totalAssets: amount(assets.totalAssets),
        totalAssetsRaw: assets.totalAssets,
      },
      equity: {
        contributedCapital: amount(equity.contributedCapital),
        contributedCapitalRaw: equity.contributedCapital,
        capitalReturned: amount(equity.capitalReturned),
        capitalReturnedRaw: equity.capitalReturned,
        retainedEarnings: {
          realizedFromWithdrawals: amount(re.realizedFromWithdrawals),
          realizedFromWithdrawalsRaw: re.realizedFromWithdrawals,
          realizedFromCollectedFees: amount(re.realizedFromCollectedFees),
          realizedFromCollectedFeesRaw: re.realizedFromCollectedFees,
          realizedFromFxEffect: amount(re.realizedFromFxEffect),
          realizedFromFxEffectRaw: re.realizedFromFxEffect,
          total: amount(re.total),
          totalRaw: re.total,
        },
        totalEquity: amount(equity.totalEquity),
        totalEquityRaw: equity.totalEquity,
      },
    },
    realizedPnl: {
      netPnl: amount(pnl.netPnl),
      netPnlRaw: pnl.netPnl,
      realizedFromWithdrawals: amount(pnl.realizedFromWithdrawals),
      realizedFromWithdrawalsRaw: pnl.realizedFromWithdrawals,
      realizedFromCollectedFees: amount(pnl.realizedFromCollectedFees),
      realizedFromCollectedFeesRaw: pnl.realizedFromCollectedFees,
      realizedFromFxEffect: amount(pnl.realizedFromFxEffect),
      realizedFromFxEffectRaw: pnl.realizedFromFxEffect,
    },
    journalEntries: report.journalEntries.map((entry) => ({
      date: timestamp(entry.entryDate),
      description: entry.description,
      memo: entry.memo,
      lines: entry.lines.map((line) => ({
        side: line.side,
        account: `${line.accountCode} — ${line.accountName} (${line.accountCategory})`,
        amountReporting: line.amountReporting === null ? null : amount(line.amountReporting),
        amountReportingRaw: line.amountReporting,
      })),
    })),
  };
}

// =============================================================================
// Position APR
// =============================================================================

function bpsToPct(bps: number): string {
  return formatPercentage(bps / 100, 2);
}

interface AprQuoteContext {
  symbol: string;
  decimals: number;
}

function formatAprPeriod(
  period: AprPeriodData,
  quote: AprQuoteContext,
): Record<string, unknown> {
  const days = period.durationSeconds / 86400;
  return {
    period: {
      start: timestamp(period.startTimestamp),
      end: timestamp(period.endTimestamp),
      durationDays: Number(days.toFixed(2)),
    },
    apr: bpsToPct(period.aprBps),
    aprBps: period.aprBps,
    costBasis: formatTokenAmount(period.costBasis, quote.symbol, quote.decimals),
    costBasisRaw: period.costBasis,
    collectedYieldValue: formatTokenAmount(period.collectedYieldValue, quote.symbol, quote.decimals),
    collectedYieldValueRaw: period.collectedYieldValue,
    eventCount: period.eventCount,
  };
}

export function formatPositionApr(
  response: AprPeriodsResponse,
  quote: AprQuoteContext,
): Record<string, unknown> {
  const summary = response.summary;
  const periods = response.data;
  const fmt = (raw: string) => formatTokenAmount(raw, quote.symbol, quote.decimals);

  return {
    summary: {
      totalApr: formatPercentage(summary.totalApr, 2),
      realizedApr: formatPercentage(summary.realizedApr, 2),
      unrealizedApr: formatPercentage(summary.unrealizedApr, 2),
      baseApr: formatPercentage(summary.baseApr, 2),
      rewardApr: formatPercentage(summary.rewardApr, 2),
      activeDays: {
        total: Number(summary.totalActiveDays.toFixed(2)),
        realized: Number(summary.realizedActiveDays.toFixed(2)),
        unrealized: Number(summary.unrealizedActiveDays.toFixed(2)),
      },
      realizedFees: fmt(summary.realizedFees),
      realizedFeesRaw: summary.realizedFees,
      realizedTWCostBasis: fmt(summary.realizedTWCostBasis),
      realizedTWCostBasisRaw: summary.realizedTWCostBasis,
      unrealizedFees: fmt(summary.unrealizedFees),
      unrealizedFeesRaw: summary.unrealizedFees,
      unrealizedCostBasis: fmt(summary.unrealizedCostBasis),
      unrealizedCostBasisRaw: summary.unrealizedCostBasis,
      belowThreshold: summary.belowThreshold,
      note: summary.belowThreshold
        ? 'Position has too little history for reliable APR — treat values as preliminary.'
        : null,
    },
    periods: periods.map((p) => formatAprPeriod(p, quote)),
  };
}

// =============================================================================
// Close Orders
// =============================================================================

/**
 * Build a §3.1 pool summary from a resolved {@link PositionContext}. Used by
 * tools (close orders, simulate, pnl-curve) that emit position-shaped items
 * but receive only an order-level payload from upstream.
 */
function poolSummaryFromContext(ctx: PositionContext): Record<string, unknown> {
  return formatPoolSummary({
    chainId: ctx.pool.chainId,
    poolAddress: ctx.pool.address,
    feeBps: ctx.feeBps,
    isToken0Quote: ctx.isToken0Quote,
    token0: ctx.token0,
    token1: ctx.token1,
  });
}

export function formatCloseOrders(
  orders: SerializedCloseOrder[],
  ctx: PositionContext,
): Record<string, unknown>[] {
  const pool = poolSummaryFromContext(ctx);
  const { baseToken, quoteToken } = ctx;

  return orders.map((order) => {
    let triggerPriceRaw: string | null = null;
    let triggerPriceDisplay: string | null = null;
    if (order.triggerTick !== null) {
      const priceBigInt = tickToPrice(
        order.triggerTick,
        baseToken.address,
        quoteToken.address,
        baseToken.decimals,
      );
      triggerPriceRaw = priceBigInt.toString();
      triggerPriceDisplay = formatTokenAmount(
        triggerPriceRaw,
        quoteToken.symbol,
        quoteToken.decimals,
      );
    }

    return {
      id: order.id,
      closeOrderHash: order.closeOrderHash,
      closeOrderType: order.closeOrderType,
      automationState: order.automationState,
      executionAttempts: order.executionAttempts,
      lastError: order.lastError,
      pool,
      triggerTick: order.triggerTick,
      triggerPrice: triggerPriceDisplay,
      triggerPriceRaw,
      triggerMode: order.triggerMode,
      slippageBps: order.slippageBps,
      swapDirection: order.swapDirection,
      swapSlippageBps: order.swapSlippageBps,
      validUntil: order.validUntil ? timestamp(order.validUntil) : null,
      payoutAddress: order.payoutAddress,
      contractAddress: order.contractAddress,
      operatorAddress: order.operatorAddress,
      createdAt: timestamp(order.createdAt),
      updatedAt: timestamp(order.updatedAt),
    };
  });
}

export { pickAddress, timestamp, pct, formatPoolSummary };
export type { PoolSummaryRaw };
