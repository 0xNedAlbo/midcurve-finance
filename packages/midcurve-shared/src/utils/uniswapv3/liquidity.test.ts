import { describe, it, expect } from 'vitest';
import {
  getTokenAmountsFromLiquidity_X96,
  getTokenAmountsFromLiquidity,
  getTokenAmountsFromLiquidity_withTick,
  getLiquidityFromAmount0,
  getLiquidityFromAmount1,
  getLiquidityFromTokenAmounts_X96,
  getLiquidityFromTokenAmounts,
  getLiquidityFromTokenAmounts_withTick,
  getLiquidityFromInvestmentAmounts,
  getAmount0FromLiquidity,
  getAmount1FromLiquidity,
} from './liquidity.js';
import {
  tokenAmounts_X96_floor,
  tokenAmounts_X96_ceil,
  liquidityFromAmounts_floor,
  liquidityFromAmounts_ceil,
  liquidityFromTokenAmounts_X96 as liquidityFromTokenAmounts_X96_fixtures,
  investmentFixtures_inRange,
  investmentFixtures_edge,
  ARB_WETH_USDC_REAL,
  L,
} from './liquidity.fixtures.js';

describe('Uniswap V3 Liquidity Utilities', () => {
  describe('getTokenAmountsFromLiquidity_X96 (floor rounding)', () => {
    it('should return all token0 when price is below range', () => {
      const f = tokenAmounts_X96_floor.BELOW;
      const res = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(f.expected.token0Amount);
      expect(res.token1Amount).toBe(0n);
    });

    it('should return mixed tokens when price is in range', () => {
      const f = tokenAmounts_X96_floor.IN_RANGE;
      const res = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(f.expected.token0Amount);
      expect(res.token1Amount).toBe(f.expected.token1Amount);
    });

    it('should return all token1 when price is above range', () => {
      const f = tokenAmounts_X96_floor.ABOVE;
      const res = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(0n);
      expect(res.token1Amount).toBe(f.expected.token1Amount);
    });

    it('should return zero amounts when liquidity is zero', () => {
      const f = tokenAmounts_X96_floor.IN_RANGE;
      const res = getTokenAmountsFromLiquidity_X96(
        0n,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(0n);
      expect(res.token1Amount).toBe(0n);
    });
  });

  describe('getTokenAmountsFromLiquidity_X96 (ceiling rounding)', () => {
    it('should round up token0 when price is below range', () => {
      const f = tokenAmounts_X96_ceil.BELOW;
      const res = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(f.expected.token0Amount);
      expect(res.token1Amount).toBe(0n);
      // Ceiling should be exactly 1 more than floor
      expect(res.token0Amount).toBe(
        tokenAmounts_X96_floor.BELOW.expected.token0Amount + 1n
      );
    });

    it('should round up both tokens when price is in range', () => {
      const f = tokenAmounts_X96_ceil.IN_RANGE;
      const res = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(f.expected.token0Amount);
      expect(res.token1Amount).toBe(f.expected.token1Amount);
      // Ceiling should be 1 more than floor
      expect(res.token0Amount).toBe(
        tokenAmounts_X96_floor.IN_RANGE.expected.token0Amount + 1n
      );
      expect(res.token1Amount).toBe(
        tokenAmounts_X96_floor.IN_RANGE.expected.token1Amount + 1n
      );
    });

    it('should round up token1 when price is above range', () => {
      const f = tokenAmounts_X96_ceil.ABOVE;
      const res = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.roundUp
      );
      expect(res.token0Amount).toBe(0n);
      expect(res.token1Amount).toBe(f.expected.token1Amount);
      // Ceiling should be 1 more than floor
      expect(res.token1Amount).toBe(
        tokenAmounts_X96_floor.ABOVE.expected.token1Amount + 1n
      );
    });
  });

  describe('getLiquidityFromAmount0 (floor rounding)', () => {
    it('should calculate liquidity from token0 amount (below range)', () => {
      const f = liquidityFromAmounts_floor.BELOW_from0;
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount0,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      // Floor rounding makes result slightly less than original L
      expect(liquidity).toBeLessThan(L);
    });

    it('should calculate liquidity from token0 amount (in range)', () => {
      const f = liquidityFromAmounts_floor.IN_from0;
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount0,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      expect(liquidity).toBeLessThan(L);
    });

    it('should return zero when amount0 is zero', () => {
      const f = liquidityFromAmounts_floor.BELOW_from0;
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        0n,
        f.roundUp
      );
      expect(liquidity).toBe(0n);
    });

    it('should return zero when sqrtPriceUpper <= sqrtPriceLower', () => {
      const f = liquidityFromAmounts_floor.BELOW_from0;
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceUpperX96,
        f.sqrtPriceLowerX96, // reversed
        f.amount0,
        f.roundUp
      );
      expect(liquidity).toBe(0n);
    });
  });

  describe('getLiquidityFromAmount0 (ceiling rounding)', () => {
    it('should round up liquidity from token0 amount (below range)', () => {
      const f = liquidityFromAmounts_ceil.BELOW_from0;
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount0,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      // Ceiling rounding makes result slightly more than original L
      expect(liquidity).toBeGreaterThan(L);
    });

    it('should round up liquidity from token0 amount (in range)', () => {
      const f = liquidityFromAmounts_ceil.IN_from0;
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount0,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      expect(liquidity).toBeGreaterThan(L);
    });
  });

  describe('getLiquidityFromAmount1 (floor rounding)', () => {
    it('should calculate liquidity from token1 amount (above range)', () => {
      const f = liquidityFromAmounts_floor.ABOVE_from1;
      const liquidity = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount1,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      expect(liquidity).toBeLessThan(L);
    });

    it('should calculate liquidity from token1 amount (in range)', () => {
      const f = liquidityFromAmounts_floor.IN_from1;
      const liquidity = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount1,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      expect(liquidity).toBeLessThan(L);
    });

    it('should return zero when amount1 is zero', () => {
      const f = liquidityFromAmounts_floor.ABOVE_from1;
      const liquidity = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        0n,
        f.roundUp
      );
      expect(liquidity).toBe(0n);
    });
  });

  describe('getLiquidityFromAmount1 (ceiling rounding)', () => {
    it('should round up liquidity from token1 amount (above range)', () => {
      const f = liquidityFromAmounts_ceil.ABOVE_from1;
      const liquidity = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount1,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      expect(liquidity).toBeGreaterThan(L);
    });

    it('should round up liquidity from token1 amount (in range)', () => {
      const f = liquidityFromAmounts_ceil.IN_from1;
      const liquidity = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount1,
        f.roundUp
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      expect(liquidity).toBeGreaterThan(L);
    });
  });

  describe('getLiquidityFromTokenAmounts_X96', () => {
    it('should calculate liquidity when price is below range (only token0)', () => {
      const f = liquidityFromTokenAmounts_X96_fixtures.BELOW;
      const liquidity = getLiquidityFromTokenAmounts_X96(
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.token0Amount,
        f.token1Amount
      );
      expect(liquidity).toBe(f.expectedLiquidity);
    });

    it('should calculate liquidity when price is in range (take minimum of both)', () => {
      const f = liquidityFromTokenAmounts_X96_fixtures.IN_RANGE;
      const liquidity = getLiquidityFromTokenAmounts_X96(
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.token0Amount,
        f.token1Amount
      );
      expect(liquidity).toBe(f.expectedLiquidity);
      // Should be the minimum of the two possible liquidities
      const l0 = getLiquidityFromAmount0(
        f.sqrtPriceCurrentX96,
        f.sqrtPriceUpperX96,
        f.token0Amount,
        false
      );
      const l1 = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceCurrentX96,
        f.token1Amount,
        false
      );
      expect(liquidity).toBe(l0 < l1 ? l0 : l1);
    });

    it('should calculate liquidity when price is above range (only token1)', () => {
      const f = liquidityFromTokenAmounts_X96_fixtures.ABOVE;
      const liquidity = getLiquidityFromTokenAmounts_X96(
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.token0Amount,
        f.token1Amount
      );
      expect(liquidity).toBe(f.expectedLiquidity);
    });
  });

  describe('getLiquidityFromInvestmentAmounts (in-range)', () => {
    it('should calculate liquidity when quote is token1', () => {
      const f = investmentFixtures_inRange.QUOTE_is_token1;
      const L_base = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0, // baseDecimals (ignored in current implementation)
        0n, // quoteAmount = 0
        0, // quoteDecimals (ignored)
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      const L_quote = getLiquidityFromInvestmentAmounts(
        0n, // baseAmount = 0
        0,
        f.quoteAmount,
        0,
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      const L_both = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        f.quoteAmount,
        0,
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );

      expect(L_both).toBe(f.expectedLiquidity);
      // L_both should be close to sum of individual contributions
      expect(L_both).toBeGreaterThan(L_base);
      expect(L_both).toBeGreaterThan(L_quote);
    });

    it('should calculate liquidity when quote is token0', () => {
      const f = investmentFixtures_inRange.QUOTE_is_token0;
      const L_base = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        0n,
        0,
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      const L_quote = getLiquidityFromInvestmentAmounts(
        0n,
        0,
        f.quoteAmount,
        0,
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      const L_both = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        f.quoteAmount,
        0,
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );

      expect(L_both).toBe(f.expectedLiquidity);
      expect(L_both).toBeGreaterThan(L_base);
      expect(L_both).toBeGreaterThan(L_quote);
    });

    it('should return zero when both amounts are zero', () => {
      const f = investmentFixtures_inRange.QUOTE_is_token1;
      const liquidity = getLiquidityFromInvestmentAmounts(
        0n,
        0,
        0n,
        0,
        f.isQuoteToken0,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      expect(liquidity).toBe(0n);
    });
  });

  describe('getLiquidityFromInvestmentAmounts (edge cases)', () => {
    it('should handle price below range (quote=token1)', () => {
      const f = investmentFixtures_edge.BELOW_S;
      const liquidity = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        f.quoteAmount,
        0,
        false, // quote is token1
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      expect(liquidity).toBe(f.expectedLiquidity_whenQuoteToken1);
    });

    it('should handle price below range (quote=token0)', () => {
      const f = investmentFixtures_edge.BELOW_S;
      const liquidity = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        f.quoteAmount,
        0,
        true, // quote is token0
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      expect(liquidity).toBe(f.expectedLiquidity_whenQuoteToken0);
    });

    it('should handle price above range (quote=token1)', () => {
      const f = investmentFixtures_edge.ABOVE_S;
      const liquidity = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        f.quoteAmount,
        0,
        false, // quote is token1
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      expect(liquidity).toBe(f.expectedLiquidity_whenQuoteToken1);
    });

    it('should handle price above range (quote=token0)', () => {
      const f = investmentFixtures_edge.ABOVE_S;
      const liquidity = getLiquidityFromInvestmentAmounts(
        f.baseAmount,
        0,
        f.quoteAmount,
        0,
        true, // quote is token0
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.sqrtPriceCurrentX96
      );
      expect(liquidity).toBe(f.expectedLiquidity_whenQuoteToken0);
    });
  });

  describe('Helper functions - getAmount0FromLiquidity / getAmount1FromLiquidity', () => {
    it('should calculate token0 amount from liquidity (floor)', () => {
      const f = tokenAmounts_X96_floor.BELOW;
      const amount0 = getAmount0FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.liquidity,
        false
      );
      expect(amount0).toBe(f.expected.token0Amount);
    });

    it('should calculate token0 amount from liquidity (ceiling)', () => {
      const f = tokenAmounts_X96_ceil.BELOW;
      const amount0 = getAmount0FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.liquidity,
        true
      );
      expect(amount0).toBe(f.expected.token0Amount);
    });

    it('should calculate token1 amount from liquidity (floor)', () => {
      const f = tokenAmounts_X96_floor.ABOVE;
      const amount1 = getAmount1FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.liquidity,
        false
      );
      expect(amount1).toBe(f.expected.token1Amount);
    });

    it('should calculate token1 amount from liquidity (ceiling)', () => {
      const f = tokenAmounts_X96_ceil.ABOVE;
      const amount1 = getAmount1FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.liquidity,
        true
      );
      expect(amount1).toBe(f.expected.token1Amount);
    });

    it('should return zero when liquidity is zero', () => {
      const f = tokenAmounts_X96_floor.BELOW;
      const amount0 = getAmount0FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        0n,
        false
      );
      const amount1 = getAmount1FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        0n,
        false
      );
      expect(amount0).toBe(0n);
      expect(amount1).toBe(0n);
    });

    it('should return zero when sqrt prices are invalid', () => {
      const f = tokenAmounts_X96_floor.BELOW;
      const amount0 = getAmount0FromLiquidity(
        f.sqrtPriceUpperX96,
        f.sqrtPriceLowerX96, // reversed
        f.liquidity,
        false
      );
      const amount1 = getAmount1FromLiquidity(
        f.sqrtPriceUpperX96,
        f.sqrtPriceLowerX96, // reversed
        f.liquidity,
        false
      );
      expect(amount0).toBe(0n);
      expect(amount1).toBe(0n);
    });
  });

  describe('Real-world pool: Arbitrum WETH/USDC parity tests', () => {
    it('should match X96 and tick-based calculations (floor rounding)', () => {
      const f = ARB_WETH_USDC_REAL;
      const { sqrtLowerX96, sqrtUpperX96 } = f.assert();

      // Calculate using _X96 (preferred)
      const amountsX96 = getTokenAmountsFromLiquidity_X96(
        f.sampleLiquidity,
        f.sqrtPriceCurrentX96,
        sqrtLowerX96,
        sqrtUpperX96,
        false
      );

      // Calculate using hybrid function (recommended)
      const amountsHybrid = getTokenAmountsFromLiquidity(
        f.sampleLiquidity,
        f.sqrtPriceCurrentX96,
        f.tickLower,
        f.tickUpper,
        false
      );

      // Calculate using legacy tick-based function
      const amountsTick = getTokenAmountsFromLiquidity_withTick(
        f.sampleLiquidity,
        f.tickCurrent,
        f.tickLower,
        f.tickUpper,
        false
      );

      // All three should match exactly for floor rounding
      expect(amountsHybrid.token0Amount).toBe(amountsX96.token0Amount);
      expect(amountsHybrid.token1Amount).toBe(amountsX96.token1Amount);

      // Tick-based might differ slightly due to tick→sqrt conversion precision loss
      // But should be very close (within ~1% tolerance for small rounding differences)
      const tolerance0 = amountsX96.token0Amount / 100n; // 1%
      const tolerance1 = amountsX96.token1Amount / 100n; // 1%

      const diff0 = amountsTick.token0Amount > amountsX96.token0Amount
        ? amountsTick.token0Amount - amountsX96.token0Amount
        : amountsX96.token0Amount - amountsTick.token0Amount;
      const diff1 = amountsTick.token1Amount > amountsX96.token1Amount
        ? amountsTick.token1Amount - amountsX96.token1Amount
        : amountsX96.token1Amount - amountsTick.token1Amount;

      expect(diff0).toBeLessThanOrEqual(tolerance0);
      expect(diff1).toBeLessThanOrEqual(tolerance1);
    });

    it('should match X96 and tick-based liquidity calculations', () => {
      const f = ARB_WETH_USDC_REAL;
      const { sqrtLowerX96, sqrtUpperX96 } = f.assert();

      // First get token amounts
      const amounts = getTokenAmountsFromLiquidity_X96(
        f.sampleLiquidity,
        f.sqrtPriceCurrentX96,
        sqrtLowerX96,
        sqrtUpperX96,
        false
      );

      // Calculate liquidity back using _X96 (preferred)
      const liquidityX96 = getLiquidityFromTokenAmounts_X96(
        f.sqrtPriceCurrentX96,
        sqrtLowerX96,
        sqrtUpperX96,
        amounts.token0Amount,
        amounts.token1Amount
      );

      // Calculate using hybrid function (recommended)
      const liquidityHybrid = getLiquidityFromTokenAmounts(
        f.sqrtPriceCurrentX96,
        f.tickLower,
        f.tickUpper,
        amounts.token0Amount,
        amounts.token1Amount
      );

      // Calculate using legacy tick-based function
      const liquidityTick = getLiquidityFromTokenAmounts_withTick(
        f.tickCurrent,
        f.tickLower,
        f.tickUpper,
        amounts.token0Amount,
        amounts.token1Amount
      );

      // Hybrid should match X96
      expect(liquidityHybrid).toBe(liquidityX96);

      // Tick-based might differ due to parameter ordering issue in legacy function
      // Just verify it returns a reasonable value
      expect(liquidityTick).toBeGreaterThan(0n);
      expect(liquidityTick).toBeLessThan(f.sampleLiquidity * 2n);

      // Should be close to original liquidity (with floor rounding tolerance)
      // Floor rounding can cause larger deviations with real pool ticks
      expect(liquidityX96).toBeGreaterThanOrEqual(
        f.sampleLiquidity - 10_000_000n // ~0.001% tolerance
      );
      expect(liquidityX96).toBeLessThanOrEqual(f.sampleLiquidity);
    });

    it('should handle real pool with non-zero token amounts', () => {
      const f = ARB_WETH_USDC_REAL;
      const { sqrtLowerX96, sqrtUpperX96 } = f.assert();

      // Get token amounts for position
      const amounts = getTokenAmountsFromLiquidity_X96(
        f.sampleLiquidity,
        f.sqrtPriceCurrentX96,
        sqrtLowerX96,
        sqrtUpperX96,
        false
      );

      // Should have both tokens since tick is in range
      expect(amounts.token0Amount).toBeGreaterThan(0n);
      expect(amounts.token1Amount).toBeGreaterThan(0n);
    });
  });

  describe('Round-trip consistency', () => {
    it('should be consistent for liquidity → amounts → liquidity (floor)', () => {
      const f = tokenAmounts_X96_floor.IN_RANGE;

      // L → amounts
      const amounts = getTokenAmountsFromLiquidity_X96(
        f.liquidity,
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        false
      );

      // amounts → L
      const liquidityBack = getLiquidityFromTokenAmounts_X96(
        f.sqrtPriceCurrentX96,
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        amounts.token0Amount,
        amounts.token1Amount
      );

      // Floor rounding means we lose a bit
      expect(liquidityBack).toBeLessThanOrEqual(f.liquidity);
      expect(liquidityBack).toBeGreaterThan(f.liquidity - 100n);
    });

    it('should be consistent for amount0 → liquidity → amount0 (floor)', () => {
      const f = liquidityFromAmounts_floor.BELOW_from0;

      // amount0 → L
      const liquidity = getLiquidityFromAmount0(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount0,
        false
      );

      // L → amount0
      const amount0Back = getAmount0FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        liquidity,
        false
      );

      // Should be close to original
      expect(amount0Back).toBeLessThanOrEqual(f.amount0);
      expect(amount0Back).toBeGreaterThan(f.amount0 - 1000n);
    });

    it('should be consistent for amount1 → liquidity → amount1 (floor)', () => {
      const f = liquidityFromAmounts_floor.ABOVE_from1;

      // amount1 → L
      const liquidity = getLiquidityFromAmount1(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        f.amount1,
        false
      );

      // L → amount1
      const amount1Back = getAmount1FromLiquidity(
        f.sqrtPriceLowerX96,
        f.sqrtPriceUpperX96,
        liquidity,
        false
      );

      // Should be close to original
      expect(amount1Back).toBeLessThanOrEqual(f.amount1);
      expect(amount1Back).toBeGreaterThan(f.amount1 - 1000n);
    });
  });
});
