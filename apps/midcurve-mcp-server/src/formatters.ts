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
  type SerializedConversionSummary,
  type SerializedRebalancingSegment,
} from '@midcurve/shared';
import type {
  AprPeriodData,
  AprPeriodsResponse,
  PositionAccountingResponse,
} from '@midcurve/api-shared';

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
      realizedFromWithdrawals: formatReportingAmount(pnl.realizedFromWithdrawals, cur),
      realizedFromCollectedFees: formatReportingAmount(pnl.realizedFromCollectedFees, cur),
      realizedFromFxEffect: formatReportingAmount(pnl.realizedFromFxEffect, cur),
    },
    instruments: pnl.instruments.map((inst) => ({
      instrumentRef: inst.instrumentRef,
      poolSymbol: inst.poolSymbol,
      protocol: inst.protocol,
      chainId: inst.chainId,
      feeTier: inst.feeTier,
      netPnl: formatReportingAmount(inst.netPnl, cur),
      realizedFromWithdrawals: formatReportingAmount(inst.realizedFromWithdrawals, cur),
      realizedFromCollectedFees: formatReportingAmount(inst.realizedFromCollectedFees, cur),
      realizedFromFxEffect: formatReportingAmount(inst.realizedFromFxEffect, cur),
      positions: inst.positions.map((pos) => ({
        positionRef: pos.positionRef,
        nftId: pos.nftId,
        netPnl: formatReportingAmount(pos.netPnl, cur),
        realizedFromWithdrawals: formatReportingAmount(pos.realizedFromWithdrawals, cur),
        realizedFromCollectedFees: formatReportingAmount(pos.realizedFromCollectedFees, cur),
        realizedFromFxEffect: formatReportingAmount(pos.realizedFromFxEffect, cur),
      })),
    })),
  };
}

interface PoolRaw {
  protocol: string;
  feeBps: number;
  token0: { symbol: string; address: string; decimals: number };
  token1: { symbol: string; address: string; decimals: number };
  config?: Record<string, unknown>;
  state?: Record<string, unknown>;
  metrics?: { tvlUsd?: string; volume24hUsd?: string; volume7dUsd?: string };
}

export function formatPool(pool: PoolRaw): Record<string, unknown> {
  const m = pool.metrics ?? {};
  return {
    protocol: pool.protocol,
    pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
    feeTier: `${(pool.feeBps / 10_000).toFixed(2)}%`,
    token0: pool.token0,
    token1: pool.token1,
    metrics: {
      tvl: m.tvlUsd ? formatUSDValue(m.tvlUsd) : null,
      volume24h: m.volume24hUsd ? formatUSDValue(m.volume24hUsd) : null,
      volume7d: m.volume7dUsd ? formatUSDValue(m.volume7dUsd) : null,
    },
    state: pool.state,
    config: pool.config,
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

  return {
    period: {
      start: timestamp(segment.startTimestamp),
      end: segment.isTrailing ? 'now' : timestamp(segment.endTimestamp),
    },
    direction,
    baseAmount: formatTokenAmount(absBase.toString(), summary.baseTokenSymbol, summary.baseTokenDecimals),
    quoteAmount: formatTokenAmount(absQuote.toString(), summary.quoteTokenSymbol, summary.quoteTokenDecimals),
    avgPrice: formatAvgPrice(segment.avgPrice, summary.quoteTokenDecimals, summary.quoteTokenSymbol),
    feesEarned:
      segment.feesEarned === '0'
        ? null
        : formatTokenAmount(segment.feesEarned, summary.quoteTokenSymbol, summary.quoteTokenDecimals),
    raw: {
      deltaBase: segment.deltaBase,
      deltaQuote: segment.deltaQuote,
      avgPrice: segment.avgPrice,
      feesEarned: segment.feesEarned,
    },
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

  const tokenAmount = (raw: string, symbol: string, decimals: number) =>
    formatTokenAmount(raw, symbol, decimals);

  return {
    baseToken: { symbol: baseTokenSymbol, decimals: baseTokenDecimals },
    quoteToken: { symbol: quoteTokenSymbol, decimals: quoteTokenDecimals },
    isClosed: summary.isClosed,
    daysActive: summary.daysActive,
    deposits: {
      base: tokenAmount(summary.netDepositBase, baseTokenSymbol, baseTokenDecimals),
      quote: tokenAmount(summary.netDepositQuote, quoteTokenSymbol, quoteTokenDecimals),
      avgPrice: formatAvgPrice(summary.netDepositAvgPrice, quoteTokenDecimals, quoteTokenSymbol),
    },
    withdrawn: {
      base: tokenAmount(summary.withdrawnBase, baseTokenSymbol, baseTokenDecimals),
      quote: tokenAmount(summary.withdrawnQuote, quoteTokenSymbol, quoteTokenDecimals),
    },
    currentHoldings: {
      base: tokenAmount(summary.currentBase, baseTokenSymbol, baseTokenDecimals),
      quote: tokenAmount(summary.currentQuote, quoteTokenSymbol, quoteTokenDecimals),
      spotPrice: formatAvgPrice(summary.currentSpotPrice, quoteTokenDecimals, quoteTokenSymbol),
    },
    netConversion: {
      direction: netDirection,
      baseAmount: tokenAmount(absNetBase.toString(), baseTokenSymbol, baseTokenDecimals),
      quoteAmount: tokenAmount(absNetQuote.toString(), quoteTokenSymbol, quoteTokenDecimals),
      avgExecutionPrice: formatAvgPrice(summary.netRebalancingAvgPrice, quoteTokenDecimals, quoteTokenSymbol),
    },
    ammBought: summary.ammBoughtBase === '0'
      ? null
      : {
          base: tokenAmount(summary.ammBoughtBase, baseTokenSymbol, baseTokenDecimals),
          avgPrice: formatAvgPrice(summary.ammBoughtAvgPrice, quoteTokenDecimals, quoteTokenSymbol),
        },
    ammSold: summary.ammSoldBase === '0'
      ? null
      : {
          base: tokenAmount(summary.ammSoldBase, baseTokenSymbol, baseTokenDecimals),
          avgPrice: formatAvgPrice(summary.ammSoldAvgPrice, quoteTokenDecimals, quoteTokenSymbol),
        },
    totalPremium: summary.totalPremium === '0'
      ? null
      : tokenAmount(summary.totalPremium, quoteTokenSymbol, quoteTokenDecimals),
    segments: summary.segments.map((s) => formatSegment(s, summary)),
    raw: summary,
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

  return {
    positionRef: report.positionRef,
    reportingCurrency: cur,
    balanceSheet: {
      assets: {
        lpPositionAtCost: amount(report.balanceSheet.assets.lpPositionAtCost),
        totalAssets: amount(report.balanceSheet.assets.totalAssets),
      },
      equity: {
        contributedCapital: amount(report.balanceSheet.equity.contributedCapital),
        capitalReturned: amount(report.balanceSheet.equity.capitalReturned),
        retainedEarnings: {
          realizedFromWithdrawals: amount(
            report.balanceSheet.equity.retainedEarnings.realizedFromWithdrawals,
          ),
          realizedFromCollectedFees: amount(
            report.balanceSheet.equity.retainedEarnings.realizedFromCollectedFees,
          ),
          realizedFromFxEffect: amount(
            report.balanceSheet.equity.retainedEarnings.realizedFromFxEffect,
          ),
          total: amount(report.balanceSheet.equity.retainedEarnings.total),
        },
        totalEquity: amount(report.balanceSheet.equity.totalEquity),
      },
    },
    realizedPnl: {
      netPnl: amount(report.pnl.netPnl),
      realizedFromWithdrawals: amount(report.pnl.realizedFromWithdrawals),
      realizedFromCollectedFees: amount(report.pnl.realizedFromCollectedFees),
      realizedFromFxEffect: amount(report.pnl.realizedFromFxEffect),
    },
    journalEntries: report.journalEntries.map((entry) => ({
      date: timestamp(entry.entryDate),
      description: entry.description,
      memo: entry.memo,
      lines: entry.lines.map((line) => ({
        side: line.side,
        account: `${line.accountCode} — ${line.accountName} (${line.accountCategory})`,
        amount: line.amountReporting === null ? null : amount(line.amountReporting),
      })),
    })),
    raw: report,
  };
}

// =============================================================================
// Position APR
// =============================================================================

function bpsToPct(bps: number): string {
  return formatPercentage(bps / 100, 2);
}

function formatAprPeriod(period: AprPeriodData): Record<string, unknown> {
  const days = period.durationSeconds / 86400;
  return {
    period: {
      start: timestamp(period.startTimestamp),
      end: timestamp(period.endTimestamp),
      durationDays: Number(days.toFixed(2)),
    },
    apr: bpsToPct(period.aprBps),
    eventCount: period.eventCount,
    raw: {
      costBasis: period.costBasis,
      collectedYieldValue: period.collectedYieldValue,
      aprBps: period.aprBps,
    },
  };
}

export function formatPositionApr(
  response: AprPeriodsResponse,
): Record<string, unknown> {
  const summary = response.summary;
  const periods = response.data;

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
      belowThreshold: summary.belowThreshold,
      note: summary.belowThreshold
        ? 'Position has too little history for reliable APR — treat values as preliminary.'
        : null,
    },
    periods: periods.map(formatAprPeriod),
    raw: {
      summary,
      periods,
    },
  };
}

export { pickAddress, timestamp, pct };
