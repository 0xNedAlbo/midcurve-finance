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
  if (!value) return null;
  return formatTokenAmount(value, symbol, decimals);
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
}

export function formatPositionListItem(item: PositionListItemRaw): Record<string, unknown> {
  return {
    positionHash: item.positionHash,
    protocol: item.protocol,
    type: item.type,
    currentValueRaw: item.currentValue,
    costBasisRaw: item.costBasis,
    realizedPnlRaw: item.realizedPnl,
    unrealizedPnlRaw: item.unrealizedPnl,
    collectedYieldRaw: item.collectedYield,
    unclaimedYieldRaw: item.unclaimedYield,
    apr: {
      total: pct(item.totalApr),
      base: pct(item.baseApr),
      reward: pct(item.rewardApr),
    },
    priceRange: {
      lowerRaw: item.priceRangeLower,
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
  pool: {
    protocol: string;
    feeBps: number;
    token0: { symbol: string; decimals: number; address: string };
    token1: { symbol: string; decimals: number; address: string };
    config?: { chainId?: number; poolAddress?: string };
    state?: Record<string, unknown>;
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
  config?: Record<string, unknown>;
  state?: Record<string, unknown>;
}

export function formatPosition(p: UniswapV3PositionRaw): Record<string, unknown> {
  const quoteToken = p.isToken0Quote ? p.pool.token0 : p.pool.token1;
  const baseToken = p.isToken0Quote ? p.pool.token1 : p.pool.token0;
  const feeTier = `${(p.pool.feeBps / 100).toFixed(2)}%`;

  return {
    positionHash: p.positionHash,
    protocol: p.protocol,
    type: p.type,
    pool: {
      pair: `${baseToken.symbol}/${quoteToken.symbol}`,
      feeTier,
      chainId: p.pool.config?.chainId,
      poolAddress: p.pool.config?.poolAddress,
      baseToken: { symbol: baseToken.symbol, address: baseToken.address, decimals: baseToken.decimals },
      quoteToken: { symbol: quoteToken.symbol, address: quoteToken.address, decimals: quoteToken.decimals },
    },
    currentValue: quoteAmount(p.currentValue, quoteToken.symbol, quoteToken.decimals),
    costBasis: quoteAmount(p.costBasis, quoteToken.symbol, quoteToken.decimals),
    realizedPnl: quoteAmount(p.realizedPnl, quoteToken.symbol, quoteToken.decimals),
    unrealizedPnl: quoteAmount(p.unrealizedPnl, quoteToken.symbol, quoteToken.decimals),
    collectedYield: quoteAmount(p.collectedYield, quoteToken.symbol, quoteToken.decimals),
    unclaimedYield: quoteAmount(p.unclaimedYield, quoteToken.symbol, quoteToken.decimals),
    apr: { total: pct(p.totalApr), base: pct(p.baseApr), reward: pct(p.rewardApr) },
    priceRange: {
      lowerRaw: p.priceRangeLower,
      upperRaw: p.priceRangeUpper,
      currentRaw: p.currentPrice,
      inRange: p.inRange,
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
    feeTier: `${(pool.feeBps / 100).toFixed(2)}%`,
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

export { pickAddress, timestamp, pct };
