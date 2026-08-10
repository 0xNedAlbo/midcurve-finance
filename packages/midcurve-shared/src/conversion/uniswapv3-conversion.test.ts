import { describe, it, expect } from 'vitest';
import {
  applyCurrentPrice,
  type ConversionSummary,
  type CurrentPriceParams,
} from './uniswapv3-conversion.js';
import { getTokenAmountsFromLiquidity } from '../utils/uniswapv3/index.js';

/**
 * applyCurrentPrice — the price-dependent tail of the conversion summary.
 *
 * Split out of computeUniswapV3ConversionSummary so a caller holding a fresher
 * pool price than the one the summary was computed with can re-apply it, and
 * render numbers consistent with everything else it draws from that price.
 *
 * Fixture is the live Arbitrum vault position 0x7eBA… (WETH/USDC, 0.05%):
 * WETH is token0, USDC token1, so base = token0 and isToken0Quote = false.
 */
describe('applyCurrentPrice', () => {
  const TICK_LOWER = -201070;
  const TICK_UPPER = -197880;
  const LIQUIDITY = 3094570764498n;

  // Exact on-chain price, and the price of the tick it floors to.
  const SQRT_PRICE_EXACT = 3476237843309497840453491n;
  const SQRT_PRICE_AT_TICK = 3476196724740106474038315n;

  const baseSummary: ConversionSummary = {
    netDepositBase: 6578526936727586n,
    netDepositQuote: 34749426n,
    netDepositAvgPrice: 2318859504n,
    withdrawnBase: 2652872785374859n,
    withdrawnQuote: 21177382n,
    ammBoughtBase: 7852300617581362n,
    ammBoughtAvgPrice: 2164592369n,
    ammBoughtPremium: 0n,
    ammSoldBase: 2525176170272745n,
    ammSoldAvgPrice: 2360978243n,
    ammSoldPremium: 0n,
    netRebalancingBase: 5327124447308617n,
    netRebalancingQuote: -11035144n,
    netRebalancingAvgPrice: 2071501071n,
    totalPremium: 0n,
    currentBase: 0n,
    currentQuote: 0n,
    currentSpotPrice: 0n,
    isClosed: false,
    closePriceX96: null,
    daysActive: null,
    segments: [
      {
        index: 0,
        startTimestamp: '2026-04-15T08:06:13.000Z',
        endTimestamp: '2026-04-22T12:51:33.000Z',
        isTrailing: false,
        deltaBase: -2525176170272745n,
        deltaQuote: 5961886n,
        avgPrice: 2360978243n,
        feesEarned: 0n,
      },
      {
        index: 1,
        startTimestamp: '2026-08-09T15:37:22.000Z',
        endTimestamp: null,
        isTrailing: true,
        deltaBase: 1123311208105n,
        deltaQuote: -2163n,
        avgPrice: 1925557213n,
        feesEarned: 0n,
      },
    ],
    baseTokenSymbol: 'WETH',
    quoteTokenSymbol: 'USDC',
    baseTokenDecimals: 18,
    quoteTokenDecimals: 6,
  };

  const params: CurrentPriceParams = {
    isToken0Quote: false,
    tickLower: TICK_LOWER,
    tickUpper: TICK_UPPER,
    sqrtPriceX96: SQRT_PRICE_EXACT,
    liquidity: LIQUIDITY,
    unclaimedFees0: 0n,
    unclaimedFees1: 0n,
  };

  it('computes current holdings from the exact sqrt price', () => {
    const result = applyCurrentPrice(baseSummary, params);

    // These are the values the /conversion endpoint served for this position.
    expect(result.currentBase).toBe(9252778598661343n);
    expect(result.currentQuote).toBe(2536899n);
  });

  it('does not route the current price through a tick', () => {
    const exact = applyCurrentPrice(baseSummary, params);
    const viaTick = applyCurrentPrice(baseSummary, {
      ...params,
      sqrtPriceX96: SQRT_PRICE_AT_TICK,
    });

    // The tick-derived price is a different price and must produce different
    // holdings — the guard against anyone reintroducing a tick round trip.
    expect(viaTick.currentBase).not.toBe(exact.currentBase);
    expect(viaTick.currentQuote).not.toBe(exact.currentQuote);
    expect(exact.currentBase).toBe(
      getTokenAmountsFromLiquidity(LIQUIDITY, SQRT_PRICE_EXACT, TICK_LOWER, TICK_UPPER)
        .token0Amount,
    );
  });

  it('is idempotent — re-applying the same price changes nothing', () => {
    const once = applyCurrentPrice(baseSummary, {
      ...params,
      unclaimedFees0: 1_000_000_000_000n,
      unclaimedFees1: 250_000n,
    });
    const twice = applyCurrentPrice(once, {
      ...params,
      unclaimedFees0: 1_000_000_000_000n,
      unclaimedFees1: 250_000n,
    });

    expect(twice).toEqual(once);
  });

  it('re-applying a different price does not accumulate fee attribution', () => {
    const fees = { unclaimedFees0: 1_000_000_000_000n, unclaimedFees1: 250_000n };

    // Applying to an already-priced summary must equal applying to the base one:
    // the trailing segment's attribution is rebuilt, not added to.
    const viaBase = applyCurrentPrice(baseSummary, {
      ...params,
      ...fees,
      sqrtPriceX96: SQRT_PRICE_AT_TICK,
    });
    const viaApplied = applyCurrentPrice(applyCurrentPrice(baseSummary, { ...params, ...fees }), {
      ...params,
      ...fees,
      sqrtPriceX96: SQRT_PRICE_AT_TICK,
    });

    expect(viaApplied).toEqual(viaBase);
  });

  it('assigns unclaimed fees to the trailing segment only', () => {
    const result = applyCurrentPrice(baseSummary, {
      ...params,
      unclaimedFees1: 500_000n,
    });

    expect(result.totalPremium).toBe(500_000n);
    expect(result.segments[0]!.feesEarned).toBe(0n);
    expect(result.segments[1]!.feesEarned).toBe(500_000n);
    // The trailing segment bought base, so fees make the effective price better.
    expect(result.segments[1]!.avgPrice).not.toBe(baseSummary.segments[1]!.avgPrice);
  });

  it('leaves segment average prices at their raw ratio when there are no fees', () => {
    const result = applyCurrentPrice(baseSummary, params);

    expect(result.totalPremium).toBe(0n);
    for (const segment of result.segments) {
      expect(segment.feesEarned).toBe(0n);
      const raw =
        (segment.deltaQuote < 0n ? -segment.deltaQuote : segment.deltaQuote) *
        10n ** 18n /
        (segment.deltaBase < 0n ? -segment.deltaBase : segment.deltaBase);
      expect(segment.avgPrice).toBe(raw);
    }
  });

  it('prices a closed position at close, ignoring the current price', () => {
    const closed: ConversionSummary = {
      ...baseSummary,
      isClosed: true,
      closePriceX96: SQRT_PRICE_AT_TICK,
    };

    const result = applyCurrentPrice(closed, { ...params, liquidity: 0n });
    const atOtherPrice = applyCurrentPrice(closed, {
      ...params,
      liquidity: 0n,
      sqrtPriceX96: SQRT_PRICE_EXACT * 2n,
    });

    expect(result.currentBase).toBe(0n);
    expect(result.currentQuote).toBe(0n);
    expect(atOtherPrice.currentSpotPrice).toBe(result.currentSpotPrice);
  });

  it('holds no position value when liquidity is zero', () => {
    const result = applyCurrentPrice(baseSummary, { ...params, liquidity: 0n });

    expect(result.currentBase).toBe(0n);
    expect(result.currentQuote).toBe(0n);
    // The spot price is still the live one — the position is open, just empty.
    expect(result.currentSpotPrice).toBeGreaterThan(0n);
  });
});
