/**
 * Uniswap V3 Position Conversion Summary
 *
 * Pure function that derives "how much token A did this position convert into
 * token B and at what average price" from a serialized position + its ledger
 * events. All arithmetic stays in bigint.
 *
 * Consumed by:
 * - apps/midcurve-api (the /conversion REST endpoint)
 * - apps/midcurve-ui (the Conversion tab)
 * - apps/midcurve-mcp-server (via the REST endpoint)
 */

import {
  getTokenAmountsFromLiquidity,
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '../utils/uniswapv3/index.js';

// =============================================================================
// Input Types
//
// Narrow shapes that match the JSON-serialized form of a position and its
// ledger events. Kept local (rather than importing from @midcurve/api-shared)
// so this package preserves its zero-deps invariant.
// =============================================================================

export interface ConversionTokenInput {
  symbol: string;
  decimals: number;
}

export interface ConversionPositionInput {
  isToken0Quote: boolean;
  positionOpenedAt: string;
  archivedAt: string | null;
  config: {
    tickLower: number;
    tickUpper: number;
  };
  state: {
    liquidity: string;
    unclaimedFees0: string;
    unclaimedFees1: string;
  };
  pool: {
    token0: ConversionTokenInput;
    token1: ConversionTokenInput;
    state: {
      sqrtPriceX96: string;
    };
  };
}

export interface ConversionLedgerEvent {
  timestamp: string;
  eventType: string;
  config: {
    sqrtPriceX96: string;
    liquidityAfter: string;
    feesCollected0: string;
    feesCollected1: string;
    blockNumber: string;
    logIndex: number;
  };
  state: {
    eventType: string;
    amount0: string;
    amount1: string;
  };
}

// =============================================================================
// Output Type
// =============================================================================

export interface RebalancingSegment {
  index: number;
  startTimestamp: string;
  endTimestamp: string | null;
  isTrailing: boolean;
  deltaBase: bigint;
  deltaQuote: bigint;
  avgPrice: bigint;
  feesEarned: bigint;
}

export interface ConversionSummary {
  netDepositBase: bigint;
  netDepositQuote: bigint;
  netDepositAvgPrice: bigint;
  withdrawnBase: bigint;
  withdrawnQuote: bigint;
  ammBoughtBase: bigint;
  ammBoughtAvgPrice: bigint;
  ammBoughtPremium: bigint;
  ammSoldBase: bigint;
  ammSoldAvgPrice: bigint;
  ammSoldPremium: bigint;
  netRebalancingBase: bigint;
  netRebalancingQuote: bigint;
  netRebalancingAvgPrice: bigint;
  totalPremium: bigint;
  currentBase: bigint;
  currentQuote: bigint;
  currentSpotPrice: bigint;
  isClosed: boolean;
  /** Days position was active (for closed positions), null if still active */
  daysActive: number | null;
  segments: RebalancingSegment[];
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
}

// =============================================================================
// Helpers
// =============================================================================

function absBI(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function feesToQuote(
  fee0: bigint,
  fee1: bigint,
  sqrtPriceX96: bigint,
  baseIsToken0: boolean,
): bigint {
  if (baseIsToken0) {
    return valueOfToken0AmountInToken1(fee0, sqrtPriceX96) + fee1;
  } else {
    return fee0 + valueOfToken1AmountInToken0(fee1, sqrtPriceX96);
  }
}

function toBaseQuote(
  token0Amount: bigint,
  token1Amount: bigint,
  baseIsToken0: boolean,
): { base: bigint; quote: bigint } {
  return baseIsToken0
    ? { base: token0Amount, quote: token1Amount }
    : { base: token1Amount, quote: token0Amount };
}

function parseConfig(event: ConversionLedgerEvent) {
  return {
    sqrtPriceX96: BigInt(event.config.sqrtPriceX96),
    liquidityAfter: BigInt(event.config.liquidityAfter),
    feesCollected0: BigInt(event.config.feesCollected0),
    feesCollected1: BigInt(event.config.feesCollected1),
    blockNumber: BigInt(event.config.blockNumber),
    logIndex: event.config.logIndex,
  };
}

function parseState(event: ConversionLedgerEvent) {
  return {
    eventType: event.state.eventType,
    amount0: BigInt(event.state.amount0 ?? '0'),
    amount1: BigInt(event.state.amount1 ?? '0'),
  };
}

// =============================================================================
// Computation
// =============================================================================

export function computeUniswapV3ConversionSummary(
  position: ConversionPositionInput,
  events: ConversionLedgerEvent[],
): ConversionSummary {
  const tickLower = position.config.tickLower;
  const tickUpper = position.config.tickUpper;
  const baseIsToken0 = !position.isToken0Quote;
  const currentSqrtPriceX96 = BigInt(position.pool.state.sqrtPriceX96);
  const currentLiquidity = BigInt(position.state.liquidity);
  const isClosed = currentLiquidity === 0n;

  // Days position was active (for closed positions)
  // Use last DECREASE event timestamp as close time since archivedAt may be null
  let daysActive: number | null = null;
  if (isClosed && position.positionOpenedAt) {
    const opened = new Date(position.positionOpenedAt).getTime();
    let closedAt: number | null = null;
    if (position.archivedAt) {
      closedAt = new Date(position.archivedAt).getTime();
    } else {
      for (let j = events.length - 1; j >= 0; j--) {
        if (events[j]!.eventType === 'DECREASE_POSITION') {
          closedAt = new Date(events[j]!.timestamp).getTime();
          break;
        }
      }
    }
    if (closedAt) {
      daysActive = Math.max(1, Math.round((closedAt - opened) / (1000 * 60 * 60 * 24)));
    }
  }

  const baseToken = baseIsToken0 ? position.pool.token0 : position.pool.token1;
  const quoteToken = baseIsToken0 ? position.pool.token1 : position.pool.token0;
  const baseTokenDecimals = baseToken.decimals;

  // Filter and sort events
  const financialEvents = events
    .filter(
      (e) =>
        e.eventType === 'INCREASE_POSITION' ||
        e.eventType === 'DECREASE_POSITION' ||
        e.eventType === 'COLLECT',
    )
    .sort((a, b) => {
      const cfgA = parseConfig(a);
      const cfgB = parseConfig(b);
      const blockDiff = cfgA.blockNumber - cfgB.blockNumber;
      if (blockDiff !== 0n) return blockDiff < 0n ? -1 : 1;
      return cfgA.logIndex - cfgB.logIndex;
    });

  const scale = 10n ** BigInt(baseTokenDecimals);
  const segments: RebalancingSegment[] = [];

  // Accumulators
  let netDepositBase = 0n;
  let netDepositQuote = 0n;
  let depositVwapNumerator = 0n;
  let depositVwapDenominator = 0n;
  let withdrawnBase = 0n;
  let withdrawnQuote = 0n;
  let ammSoldBase = 0n;
  let ammSoldQuoteVolume = 0n;
  const ammSoldPremium = 0n;
  let ammBoughtBase = 0n;
  let ammBoughtQuoteVolume = 0n;
  const ammBoughtPremium = 0n;
  let totalPremium = 0n;
  let netRebalancingBase = 0n;
  let netRebalancingQuote = 0n;

  for (let i = 0; i < financialEvents.length; i++) {
    const event = financialEvents[i]!;
    const cfg = parseConfig(event);

    // Rebalancing segment
    if (i > 0) {
      const prevCfg = parseConfig(financialEvents[i - 1]!);
      const segmentL = prevCfg.liquidityAfter;

      if (segmentL > 0n) {
        const amountsStart = getTokenAmountsFromLiquidity(
          segmentL,
          prevCfg.sqrtPriceX96,
          tickLower,
          tickUpper,
        );
        const amountsEnd = getTokenAmountsFromLiquidity(
          segmentL,
          cfg.sqrtPriceX96,
          tickLower,
          tickUpper,
        );

        const { base: deltaBase, quote: deltaQuote } = toBaseQuote(
          amountsEnd.token0Amount - amountsStart.token0Amount,
          amountsEnd.token1Amount - amountsStart.token1Amount,
          baseIsToken0,
        );

        netRebalancingBase += deltaBase;
        netRebalancingQuote += deltaQuote;

        if (deltaBase < 0n) {
          ammSoldBase += absBI(deltaBase);
          ammSoldQuoteVolume += absBI(deltaQuote);
        } else if (deltaBase > 0n) {
          ammBoughtBase += absBI(deltaBase);
          ammBoughtQuoteVolume += absBI(deltaQuote);
        }

        segments.push({
          index: segments.length,
          startTimestamp: financialEvents[i - 1]!.timestamp,
          endTimestamp: event.timestamp,
          isTrailing: false,
          deltaBase,
          deltaQuote,
          avgPrice:
            deltaBase !== 0n ? (absBI(deltaQuote) * scale) / absBI(deltaBase) : 0n,
          feesEarned: 0n,
        });
      }
    }

    // Deposits only (INCREASE events) — withdrawals are excluded.
    // Withdrawals are the "exercise" of the option, not part of the deposit.
    if (event.eventType === 'INCREASE_POSITION') {
      const state = parseState(event);
      const { base: deltaBase, quote: deltaQuote } = toBaseQuote(
        state.amount0,
        state.amount1,
        baseIsToken0,
      );

      netDepositBase += deltaBase;
      netDepositQuote += deltaQuote;

      const absBase = absBI(deltaBase);
      if (absBase > 0n) {
        const spotPrice = baseIsToken0
          ? pricePerToken0InToken1(cfg.sqrtPriceX96, baseTokenDecimals)
          : pricePerToken1InToken0(cfg.sqrtPriceX96, baseTokenDecimals);
        depositVwapNumerator += spotPrice * absBase;
        depositVwapDenominator += absBase;
      }
    }

    // Track withdrawals (DECREASE events)
    if (event.eventType === 'DECREASE_POSITION') {
      const state = parseState(event);
      const { base: deltaBase, quote: deltaQuote } = toBaseQuote(
        state.amount0,
        state.amount1,
        baseIsToken0,
      );
      withdrawnBase += deltaBase;
      withdrawnQuote += deltaQuote;
    }
  }

  // Trailing segment
  if (financialEvents.length > 0) {
    const lastCfg = parseConfig(financialEvents[financialEvents.length - 1]!);
    const trailingL = lastCfg.liquidityAfter;

    if (trailingL > 0n) {
      const amountsStart = getTokenAmountsFromLiquidity(
        trailingL,
        lastCfg.sqrtPriceX96,
        tickLower,
        tickUpper,
      );
      const amountsEnd = getTokenAmountsFromLiquidity(
        trailingL,
        currentSqrtPriceX96,
        tickLower,
        tickUpper,
      );

      const { base: deltaBase, quote: deltaQuote } = toBaseQuote(
        amountsEnd.token0Amount - amountsStart.token0Amount,
        amountsEnd.token1Amount - amountsStart.token1Amount,
        baseIsToken0,
      );

      netRebalancingBase += deltaBase;
      netRebalancingQuote += deltaQuote;

      if (deltaBase < 0n) {
        ammSoldBase += absBI(deltaBase);
        ammSoldQuoteVolume += absBI(deltaQuote);
      } else if (deltaBase > 0n) {
        ammBoughtBase += absBI(deltaBase);
        ammBoughtQuoteVolume += absBI(deltaQuote);
      }

      segments.push({
        index: segments.length,
        startTimestamp: financialEvents[financialEvents.length - 1]!.timestamp,
        endTimestamp: isClosed
          ? (position.archivedAt ?? financialEvents[financialEvents.length - 1]!.timestamp)
          : null,
        isTrailing: !isClosed,
        deltaBase,
        deltaQuote,
        avgPrice:
          deltaBase !== 0n ? (absBI(deltaQuote) * scale) / absBI(deltaBase) : 0n,
        feesEarned: 0n,
      });
    }
  }

  // Current holdings (or holdings at close for closed positions)
  let currentHoldingsBase = 0n;
  let currentHoldingsQuote = 0n;
  let spotPriceX96 = currentSqrtPriceX96; // live price for active, overridden for closed
  if (isClosed) {
    // For closed positions: holdings are 0 (already counted in withdrawnBase/Quote).
    // Use the price from the final DECREASE event as the reference spot price.
    for (let j = financialEvents.length - 1; j >= 0; j--) {
      const evt = financialEvents[j]!;
      if (evt.eventType === 'DECREASE_POSITION') {
        const closeCfg = parseConfig(evt);
        if (closeCfg.liquidityAfter === 0n) {
          spotPriceX96 = closeCfg.sqrtPriceX96;
          break;
        }
      }
    }
  } else if (currentLiquidity > 0n) {
    const currentAmounts = getTokenAmountsFromLiquidity(
      currentLiquidity,
      currentSqrtPriceX96,
      tickLower,
      tickUpper,
    );
    const mapped = toBaseQuote(
      currentAmounts.token0Amount,
      currentAmounts.token1Amount,
      baseIsToken0,
    );
    currentHoldingsBase = mapped.base;
    currentHoldingsQuote = mapped.quote;
  }

  // Premium = unclaimed fees only.
  // Fees are not compounded into liquidity. Once claimed, they leave the position
  // and can go anywhere — they cannot count against the purchase or sale of assets
  // inside the position. Only unclaimed fees are still inside the position.
  totalPremium = feesToQuote(
    BigInt(position.state.unclaimedFees0),
    BigInt(position.state.unclaimedFees1),
    currentSqrtPriceX96,
    baseIsToken0,
  );

  // Assign all unclaimed fees to the last segment for execution price adjustment.
  if (segments.length > 0) {
    const attributedFees = segments.reduce((acc, s) => acc + s.feesEarned, 0n);
    const unattributedFees = totalPremium - attributedFees;
    if (unattributedFees > 0n) {
      const last = segments[segments.length - 1]!;
      last.feesEarned += unattributedFees;
      if (last.deltaBase !== 0n) {
        const effectiveQuote =
          last.deltaBase < 0n
            ? absBI(last.deltaQuote) + last.feesEarned
            : absBI(last.deltaQuote) - last.feesEarned;
        last.avgPrice = (effectiveQuote * scale) / absBI(last.deltaBase);
      }
    }
  }

  return {
    netDepositBase,
    netDepositQuote,
    netDepositAvgPrice:
      depositVwapDenominator > 0n ? depositVwapNumerator / depositVwapDenominator : 0n,
    withdrawnBase,
    withdrawnQuote,
    ammBoughtBase,
    ammBoughtAvgPrice:
      ammBoughtBase > 0n ? (ammBoughtQuoteVolume * scale) / ammBoughtBase : 0n,
    ammBoughtPremium,
    ammSoldBase,
    ammSoldAvgPrice: ammSoldBase > 0n ? (ammSoldQuoteVolume * scale) / ammSoldBase : 0n,
    ammSoldPremium,
    netRebalancingBase,
    netRebalancingQuote,
    netRebalancingAvgPrice:
      netRebalancingBase !== 0n
        ? (absBI(netRebalancingQuote) * scale) / absBI(netRebalancingBase)
        : 0n,
    totalPremium,
    segments,
    currentBase: currentHoldingsBase,
    currentQuote: currentHoldingsQuote,
    currentSpotPrice: baseIsToken0
      ? pricePerToken0InToken1(spotPriceX96, baseTokenDecimals)
      : pricePerToken1InToken0(spotPriceX96, baseTokenDecimals),
    isClosed,
    daysActive,
    baseTokenSymbol: baseToken.symbol,
    quoteTokenSymbol: quoteToken.symbol,
    baseTokenDecimals,
    quoteTokenDecimals: quoteToken.decimals,
  };
}

// =============================================================================
// Serialization
//
// Wire form — all bigint fields become string. Used by the API response and
// parsed back to bigint in the UI / MCP formatters.
// =============================================================================

export interface SerializedRebalancingSegment {
  index: number;
  startTimestamp: string;
  endTimestamp: string | null;
  isTrailing: boolean;
  deltaBase: string;
  deltaQuote: string;
  avgPrice: string;
  feesEarned: string;
}

export interface SerializedConversionSummary {
  netDepositBase: string;
  netDepositQuote: string;
  netDepositAvgPrice: string;
  withdrawnBase: string;
  withdrawnQuote: string;
  ammBoughtBase: string;
  ammBoughtAvgPrice: string;
  ammBoughtPremium: string;
  ammSoldBase: string;
  ammSoldAvgPrice: string;
  ammSoldPremium: string;
  netRebalancingBase: string;
  netRebalancingQuote: string;
  netRebalancingAvgPrice: string;
  totalPremium: string;
  currentBase: string;
  currentQuote: string;
  currentSpotPrice: string;
  isClosed: boolean;
  daysActive: number | null;
  segments: SerializedRebalancingSegment[];
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
}

export function serializeConversionSummary(
  summary: ConversionSummary,
): SerializedConversionSummary {
  return {
    netDepositBase: summary.netDepositBase.toString(),
    netDepositQuote: summary.netDepositQuote.toString(),
    netDepositAvgPrice: summary.netDepositAvgPrice.toString(),
    withdrawnBase: summary.withdrawnBase.toString(),
    withdrawnQuote: summary.withdrawnQuote.toString(),
    ammBoughtBase: summary.ammBoughtBase.toString(),
    ammBoughtAvgPrice: summary.ammBoughtAvgPrice.toString(),
    ammBoughtPremium: summary.ammBoughtPremium.toString(),
    ammSoldBase: summary.ammSoldBase.toString(),
    ammSoldAvgPrice: summary.ammSoldAvgPrice.toString(),
    ammSoldPremium: summary.ammSoldPremium.toString(),
    netRebalancingBase: summary.netRebalancingBase.toString(),
    netRebalancingQuote: summary.netRebalancingQuote.toString(),
    netRebalancingAvgPrice: summary.netRebalancingAvgPrice.toString(),
    totalPremium: summary.totalPremium.toString(),
    currentBase: summary.currentBase.toString(),
    currentQuote: summary.currentQuote.toString(),
    currentSpotPrice: summary.currentSpotPrice.toString(),
    isClosed: summary.isClosed,
    daysActive: summary.daysActive,
    segments: summary.segments.map((s) => ({
      index: s.index,
      startTimestamp: s.startTimestamp,
      endTimestamp: s.endTimestamp,
      isTrailing: s.isTrailing,
      deltaBase: s.deltaBase.toString(),
      deltaQuote: s.deltaQuote.toString(),
      avgPrice: s.avgPrice.toString(),
      feesEarned: s.feesEarned.toString(),
    })),
    baseTokenSymbol: summary.baseTokenSymbol,
    quoteTokenSymbol: summary.quoteTokenSymbol,
    baseTokenDecimals: summary.baseTokenDecimals,
    quoteTokenDecimals: summary.quoteTokenDecimals,
  };
}

export function deserializeConversionSummary(
  wire: SerializedConversionSummary,
): ConversionSummary {
  return {
    netDepositBase: BigInt(wire.netDepositBase),
    netDepositQuote: BigInt(wire.netDepositQuote),
    netDepositAvgPrice: BigInt(wire.netDepositAvgPrice),
    withdrawnBase: BigInt(wire.withdrawnBase),
    withdrawnQuote: BigInt(wire.withdrawnQuote),
    ammBoughtBase: BigInt(wire.ammBoughtBase),
    ammBoughtAvgPrice: BigInt(wire.ammBoughtAvgPrice),
    ammBoughtPremium: BigInt(wire.ammBoughtPremium),
    ammSoldBase: BigInt(wire.ammSoldBase),
    ammSoldAvgPrice: BigInt(wire.ammSoldAvgPrice),
    ammSoldPremium: BigInt(wire.ammSoldPremium),
    netRebalancingBase: BigInt(wire.netRebalancingBase),
    netRebalancingQuote: BigInt(wire.netRebalancingQuote),
    netRebalancingAvgPrice: BigInt(wire.netRebalancingAvgPrice),
    totalPremium: BigInt(wire.totalPremium),
    currentBase: BigInt(wire.currentBase),
    currentQuote: BigInt(wire.currentQuote),
    currentSpotPrice: BigInt(wire.currentSpotPrice),
    isClosed: wire.isClosed,
    daysActive: wire.daysActive,
    segments: wire.segments.map((s) => ({
      index: s.index,
      startTimestamp: s.startTimestamp,
      endTimestamp: s.endTimestamp,
      isTrailing: s.isTrailing,
      deltaBase: BigInt(s.deltaBase),
      deltaQuote: BigInt(s.deltaQuote),
      avgPrice: BigInt(s.avgPrice),
      feesEarned: BigInt(s.feesEarned),
    })),
    baseTokenSymbol: wire.baseTokenSymbol,
    quoteTokenSymbol: wire.quoteTokenSymbol,
    baseTokenDecimals: wire.baseTokenDecimals,
    quoteTokenDecimals: wire.quoteTokenDecimals,
  };
}
