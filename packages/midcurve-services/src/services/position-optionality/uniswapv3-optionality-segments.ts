/**
 * Uniswap V3 Optionality Summary Computation
 *
 * Computes aggregated optionality metrics from position ledger events.
 * Reframes LP activity in options terminology: net buy/sell, VWAP, premium earned.
 *
 * All arithmetic uses bigint. No conversions to Number or float.
 */

import {
  getTokenAmountsFromLiquidity,
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '@midcurve/shared';
import type { UniswapV3PositionLedgerEvent } from '@midcurve/shared';
import type { OptionalitySummaryData } from '@midcurve/api-shared';

// =============================================================================
// Input Types
// =============================================================================

export interface OptionalityComputationInput {
  /** Ledger events (any order — will be sorted internally) */
  events: UniswapV3PositionLedgerEvent[];

  /** Position tick bounds (immutable for position lifetime) */
  tickLower: number;
  tickUpper: number;

  /** Token ordering: true if token0 is the base token */
  baseIsToken0: boolean;

  /** Token metadata */
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;

  /** Current pool sqrtPriceX96 for holdings + trailing segment */
  currentSqrtPriceX96: bigint;

  /** Current on-chain liquidity from position state */
  currentLiquidity: bigint;

  /** Unclaimed fees in token0/token1 (accrued but not yet collected) */
  unclaimedFees0: bigint;
  unclaimedFees1: bigint;
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

// =============================================================================
// Main Computation
// =============================================================================

export function computeOptionalitySummary(
  input: OptionalityComputationInput,
): OptionalitySummaryData {
  const {
    events,
    tickLower,
    tickUpper,
    baseIsToken0,
    baseTokenSymbol,
    quoteTokenSymbol,
    baseTokenDecimals,
    quoteTokenDecimals,
    currentSqrtPriceX96,
    currentLiquidity,
    unclaimedFees0,
    unclaimedFees1,
  } = input;

  // Filter to financial events only
  const financialEvents = events.filter(
    (e) =>
      e.eventType === 'INCREASE_POSITION' ||
      e.eventType === 'DECREASE_POSITION' ||
      e.eventType === 'COLLECT',
  );

  // Sort ascending by blockchain order
  financialEvents.sort((a, b) => {
    const blockDiff = a.blockNumber - b.blockNumber;
    if (blockDiff !== 0n) return blockDiff < 0n ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  // Accumulators
  let netDepositBase = 0n;
  let netDepositQuote = 0n;
  let depositVwapNumerator = 0n;
  let depositVwapDenominator = 0n;
  let ammSoldBase = 0n;
  let ammSoldQuoteVolume = 0n;
  let ammSoldPremium = 0n;
  let ammBoughtBase = 0n;
  let ammBoughtQuoteVolume = 0n;
  let ammBoughtPremium = 0n;
  let totalPremium = 0n;
  let netRebalancingBase = 0n;
  let netRebalancingQuote = 0n;

  for (let i = 0; i < financialEvents.length; i++) {
    const event = financialEvents[i]!;
    const prevEvent = i > 0 ? financialEvents[i - 1]! : null;

    // Rebalancing segment (between previous and current event)
    if (prevEvent) {
      const segmentL = prevEvent.typedConfig.liquidityAfter;

      if (segmentL > 0n) {
        const amountsStart = getTokenAmountsFromLiquidity(
          segmentL, prevEvent.typedConfig.sqrtPriceX96, tickLower, tickUpper,
        );
        const amountsEnd = getTokenAmountsFromLiquidity(
          segmentL, event.typedConfig.sqrtPriceX96, tickLower, tickUpper,
        );

        const { base: deltaBase, quote: deltaQuote } = toBaseQuote(
          amountsEnd.token0Amount - amountsStart.token0Amount,
          amountsEnd.token1Amount - amountsStart.token1Amount,
          baseIsToken0,
        );

        const premium = feesToQuote(
          event.typedConfig.feesCollected0,
          event.typedConfig.feesCollected1,
          event.typedConfig.sqrtPriceX96,
          baseIsToken0,
        );

        netRebalancingBase += deltaBase;
        netRebalancingQuote += deltaQuote;
        totalPremium += premium;

        if (deltaBase < 0n) {
          ammSoldBase += absBI(deltaBase);
          ammSoldQuoteVolume += absBI(deltaQuote);
          ammSoldPremium += premium;
        } else if (deltaBase > 0n) {
          ammBoughtBase += absBI(deltaBase);
          ammBoughtQuoteVolume += absBI(deltaQuote);
          ammBoughtPremium += premium;
        }
      }
    }

    // Deposit / withdrawal accumulation
    if (
      event.eventType === 'INCREASE_POSITION' ||
      event.eventType === 'DECREASE_POSITION'
    ) {
      const state = event.typedState;
      let deltaToken0 = 0n;
      let deltaToken1 = 0n;

      if (state.eventType === 'INCREASE_LIQUIDITY') {
        deltaToken0 = state.amount0;
        deltaToken1 = state.amount1;
      } else if (state.eventType === 'DECREASE_LIQUIDITY') {
        deltaToken0 = -state.amount0;
        deltaToken1 = -state.amount1;
      }

      const { base: deltaBase, quote: deltaQuote } = toBaseQuote(
        deltaToken0, deltaToken1, baseIsToken0,
      );

      netDepositBase += deltaBase;
      netDepositQuote += deltaQuote;

      const absBase = absBI(deltaBase);
      if (absBase > 0n) {
        const spotPrice = baseIsToken0
          ? pricePerToken0InToken1(event.typedConfig.sqrtPriceX96, baseTokenDecimals)
          : pricePerToken1InToken0(event.typedConfig.sqrtPriceX96, baseTokenDecimals);
        depositVwapNumerator += spotPrice * absBase;
        depositVwapDenominator += absBase;
      }
    }
  }

  // Trailing segment (last event → current price)
  if (financialEvents.length > 0) {
    const lastEvent = financialEvents[financialEvents.length - 1]!;
    const trailingL = lastEvent.typedConfig.liquidityAfter;

    if (trailingL > 0n) {
      const amountsStart = getTokenAmountsFromLiquidity(
        trailingL, lastEvent.typedConfig.sqrtPriceX96, tickLower, tickUpper,
      );
      const amountsEnd = getTokenAmountsFromLiquidity(
        trailingL, currentSqrtPriceX96, tickLower, tickUpper,
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
    }
  }

  // Current holdings
  let currentHoldingsBase = 0n;
  let currentHoldingsQuote = 0n;
  if (currentLiquidity > 0n) {
    const currentAmounts = getTokenAmountsFromLiquidity(
      currentLiquidity, currentSqrtPriceX96, tickLower, tickUpper,
    );
    const mapped = toBaseQuote(
      currentAmounts.token0Amount, currentAmounts.token1Amount, baseIsToken0,
    );
    currentHoldingsBase = mapped.base;
    currentHoldingsQuote = mapped.quote;
  }

  // Add unclaimed fees to total premium
  totalPremium += feesToQuote(unclaimedFees0, unclaimedFees1, currentSqrtPriceX96, baseIsToken0);

  // Derived values
  const scale = 10n ** BigInt(baseTokenDecimals);

  const ammSoldAvgPrice =
    ammSoldBase > 0n ? (ammSoldQuoteVolume * scale) / ammSoldBase : 0n;
  const ammBoughtAvgPrice =
    ammBoughtBase > 0n ? (ammBoughtQuoteVolume * scale) / ammBoughtBase : 0n;
  const netRebalancingAvgPrice =
    netRebalancingBase !== 0n
      ? (absBI(netRebalancingQuote) * scale) / absBI(netRebalancingBase)
      : 0n;
  const netDepositAvgPrice =
    depositVwapDenominator > 0n
      ? depositVwapNumerator / depositVwapDenominator
      : 0n;
  const currentSpotPrice = baseIsToken0
    ? pricePerToken0InToken1(currentSqrtPriceX96, baseTokenDecimals)
    : pricePerToken1InToken0(currentSqrtPriceX96, baseTokenDecimals);

  return {
    netDepositBase: netDepositBase.toString(),
    netDepositQuote: netDepositQuote.toString(),
    netDepositAvgPrice: netDepositAvgPrice.toString(),
    ammBoughtBase: ammBoughtBase.toString(),
    ammBoughtAvgPrice: ammBoughtAvgPrice.toString(),
    ammBoughtPremium: ammBoughtPremium.toString(),
    ammSoldBase: ammSoldBase.toString(),
    ammSoldAvgPrice: ammSoldAvgPrice.toString(),
    ammSoldPremium: ammSoldPremium.toString(),
    netRebalancingBase: netRebalancingBase.toString(),
    netRebalancingQuote: netRebalancingQuote.toString(),
    netRebalancingAvgPrice: netRebalancingAvgPrice.toString(),
    totalPremium: totalPremium.toString(),
    currentBase: currentHoldingsBase.toString(),
    currentQuote: currentHoldingsQuote.toString(),
    currentSpotPrice: currentSpotPrice.toString(),
    baseTokenSymbol,
    quoteTokenSymbol,
    baseTokenDecimals,
    quoteTokenDecimals,
  };
}
