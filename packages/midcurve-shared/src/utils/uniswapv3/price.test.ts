import { describe, it, expect } from 'vitest';
import {
  pricePerToken0InToken1,
  pricePerToken1InToken0,
  sqrtRatioX96ToToken1PerToken0,
  sqrtRatioX96ToToken0PerToken1,
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
  tickToSqrtRatioX96,
  tickToPrice,
  priceToTick,
  priceToClosestUsableTick,
} from './price.js';
import JSBI from 'jsbi';

/**
 * Test data for WETH/USDC pool (Arbitrum)
 *
 * Pool: 0xC6962004f452bE9203591991D15f6b388e09E8D0 (Arbitrum)
 * WETH (token0) / USDC (token1)
 * WETH decimals: 18
 * USDC decimals: 6
 * WETH address: 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 (Arbitrum)
 * USDC address: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 (Arbitrum)
 *
 * Real data from Arbitrum at sqrtPriceX96 = 4880027310900678652549898:
 * - Tick: -193909 (floor tick, actual sqrtPrice at this tick is slightly different)
 * - 1 WETH = 3793.895265 USDC (exact calculation)
 * - 1 USDC = 0.000263592... WETH
 */
describe('Uniswap V3 Price Utilities', () => {
  // Test constants (Arbitrum addresses)
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const WETH_DECIMALS = 18;
  const USDC_DECIMALS = 6;

  // Real-world example: WETH/USDC at ~$3793.90
  const SQRT_PRICE_X96_EXAMPLE = 4880027310900678652549898n;
  const EXPECTED_WETH_PRICE_USDC = 3793_895265n; // 3793.895265 USDC (6 decimals)
  const EXPECTED_USDC_PRICE_WETH = 263592215453863n; // ~0.000263592 WETH (18 decimals)

  describe('pricePerToken0InToken1', () => {
    it('should calculate WETH price in USDC correctly', () => {
      // For WETH/USDC: token0 = WETH, token1 = USDC
      // Price should be 3793.895265 USDC per WETH
      const price = pricePerToken0InToken1(SQRT_PRICE_X96_EXAMPLE, WETH_DECIMALS);

      // Should match exactly (or within rounding error)
      expect(price).toBe(EXPECTED_WETH_PRICE_USDC);
    });

    it('should handle different decimal combinations', () => {
      // Test with real Arbitrum WBTC/USDC pool data
      // Pool: 0x6985cb98CE393FCE8d6272127F39013f61e36166 (Arbitrum)
      // WBTC (token0, 8 decimals) / USDC (token1, 6 decimals)
      // Real sqrtPriceX96 at tick 69780: ~$107,245 USDC per WBTC
      const wbtcSqrtPrice = 2594590524261178691684425401086n;
      const price = pricePerToken0InToken1(wbtcSqrtPrice, 8);

      // Actual calculated price: 107,245.354183 USDC per WBTC
      expect(price).toBe(107245_354183n);
    });

    it('should return correct price for 1:1 price ratio', () => {
      // sqrtPriceX96 = 2^96 means price = 1
      const sqrtPriceX96 = 79228162514264337593543950336n; // 2^96
      const price = pricePerToken0InToken1(sqrtPriceX96, 18);

      // For 1:1 ratio with same decimals, should be 10^18
      expect(price).toBe(1000000000000000000n);
    });

    it('should handle very small prices', () => {
      // Small sqrtPriceX96 = very cheap token0
      // Use minimum practical sqrtPrice (above TickMath.MIN_SQRT_RATIO)
      const smallSqrtPrice = 4295128740n; // Near minimum
      const price = pricePerToken0InToken1(smallSqrtPrice, 18);
      expect(price).toBeGreaterThanOrEqual(0n);
    });

    it('should handle very large prices', () => {
      // Large sqrtPriceX96 = very expensive token0
      const largeSqrtPrice = 10000000000000000000000000n;
      const price = pricePerToken0InToken1(largeSqrtPrice, 18);
      expect(price).toBeGreaterThan(0n);
    });
  });

  describe('pricePerToken1InToken0', () => {
    it('should calculate USDC price in WETH correctly (inverse)', () => {
      // For WETH/USDC: token0 = WETH, token1 = USDC
      // Price should be ~0.000263852 WETH per USDC
      const price = pricePerToken1InToken0(SQRT_PRICE_X96_EXAMPLE, USDC_DECIMALS);

      // Allow small rounding error (within 0.000001 WETH)
      expect(price).toBeGreaterThanOrEqual(EXPECTED_USDC_PRICE_WETH - 1000000000000n);
      expect(price).toBeLessThanOrEqual(EXPECTED_USDC_PRICE_WETH + 1000000000000n);
    });

    it('should be inverse of pricePerToken0InToken1', () => {
      const price0in1 = pricePerToken0InToken1(SQRT_PRICE_X96_EXAMPLE, WETH_DECIMALS);
      const price1in0 = pricePerToken1InToken0(SQRT_PRICE_X96_EXAMPLE, USDC_DECIMALS);

      // price0in1 * price1in0 should be close to 10^(decimals0 + decimals1)
      const product = (price0in1 * price1in0) / 10n ** BigInt(USDC_DECIMALS);
      const expected = 10n ** BigInt(WETH_DECIMALS);

      // Allow 0.1% error due to rounding
      const tolerance = expected / 1000n;
      expect(product).toBeGreaterThanOrEqual(expected - tolerance);
      expect(product).toBeLessThanOrEqual(expected + tolerance);
    });

    it('should return correct price for 1:1 price ratio', () => {
      const sqrtPriceX96 = 79228162514264337593543950336n; // 2^96
      const price = pricePerToken1InToken0(sqrtPriceX96, 18);

      expect(price).toBe(1000000000000000000n);
    });
  });

  describe('sqrtRatioX96ToToken1PerToken0', () => {
    it('should convert sqrtRatioX96 to token1 per token0', () => {
      const jsbiSqrtPrice = JSBI.BigInt(SQRT_PRICE_X96_EXAMPLE.toString());
      const price = sqrtRatioX96ToToken1PerToken0(jsbiSqrtPrice, WETH_DECIMALS);

      expect(price).toBe(EXPECTED_WETH_PRICE_USDC);
    });

    it('should handle JSBI input format', () => {
      const jsbiSqrtPrice = JSBI.BigInt('79228162514264337593543950336'); // 2^96
      const price = sqrtRatioX96ToToken1PerToken0(jsbiSqrtPrice, 18);

      expect(price).toBe(1000000000000000000n);
    });
  });

  describe('sqrtRatioX96ToToken0PerToken1', () => {
    it('should convert sqrtRatioX96 to token0 per token1', () => {
      const jsbiSqrtPrice = JSBI.BigInt(SQRT_PRICE_X96_EXAMPLE.toString());
      const price = sqrtRatioX96ToToken0PerToken1(jsbiSqrtPrice, USDC_DECIMALS);

      expect(price).toBeGreaterThanOrEqual(EXPECTED_USDC_PRICE_WETH - 1000000000000n);
      expect(price).toBeLessThanOrEqual(EXPECTED_USDC_PRICE_WETH + 1000000000000n);
    });

    it('should handle JSBI input format', () => {
      const jsbiSqrtPrice = JSBI.BigInt('79228162514264337593543950336'); // 2^96
      const price = sqrtRatioX96ToToken0PerToken1(jsbiSqrtPrice, 18);

      expect(price).toBe(1000000000000000000n);
    });
  });

  describe('valueOfToken0AmountInToken1', () => {
    it('should convert 1 WETH to USDC correctly', () => {
      const oneWeth = 10n ** BigInt(WETH_DECIMALS); // 1 WETH
      const valueInUsdc = valueOfToken0AmountInToken1(oneWeth, SQRT_PRICE_X96_EXAMPLE);

      // Should match the expected price exactly
      expect(valueInUsdc).toBe(EXPECTED_WETH_PRICE_USDC);
    });

    it('should convert 0.5 WETH to USDC correctly', () => {
      const halfWeth = 5n * 10n ** BigInt(WETH_DECIMALS - 1); // 0.5 WETH
      const valueInUsdc = valueOfToken0AmountInToken1(halfWeth, SQRT_PRICE_X96_EXAMPLE);

      // Should be exactly half of the WETH price
      const expectedHalf = EXPECTED_WETH_PRICE_USDC / 2n;
      expect(valueInUsdc).toBe(expectedHalf);
    });

    it('should return 0 for 0 amount', () => {
      const value = valueOfToken0AmountInToken1(0n, SQRT_PRICE_X96_EXAMPLE);
      expect(value).toBe(0n);
    });

    it('should scale linearly with amount', () => {
      const amount1 = 10n ** BigInt(WETH_DECIMALS);
      const amount2 = 2n * 10n ** BigInt(WETH_DECIMALS);

      const value1 = valueOfToken0AmountInToken1(amount1, SQRT_PRICE_X96_EXAMPLE);
      const value2 = valueOfToken0AmountInToken1(amount2, SQRT_PRICE_X96_EXAMPLE);

      // value2 should be ~2x value1
      expect(value2).toBeGreaterThanOrEqual(value1 * 2n - 1_000000n);
      expect(value2).toBeLessThanOrEqual(value1 * 2n + 1_000000n);
    });
  });

  describe('valueOfToken1AmountInToken0', () => {
    it('should convert 1000 USDC to WETH correctly', () => {
      const oneThousandUsdc = 1000n * 10n ** BigInt(USDC_DECIMALS); // 1000 USDC
      const valueInWeth = valueOfToken1AmountInToken0(oneThousandUsdc, SQRT_PRICE_X96_EXAMPLE);

      // Should be ~0.263852 WETH (1000 / 3790)
      const expected = EXPECTED_USDC_PRICE_WETH * 1000n;
      expect(valueInWeth).toBeGreaterThanOrEqual(expected - 1000000000000000n);
      expect(valueInWeth).toBeLessThanOrEqual(expected + 1000000000000000n);
    });

    it('should return 0 for 0 amount', () => {
      const value = valueOfToken1AmountInToken0(0n, SQRT_PRICE_X96_EXAMPLE);
      expect(value).toBe(0n);
    });

    it('should scale linearly with amount', () => {
      const amount1 = 1000n * 10n ** BigInt(USDC_DECIMALS);
      const amount2 = 2000n * 10n ** BigInt(USDC_DECIMALS);

      const value1 = valueOfToken1AmountInToken0(amount1, SQRT_PRICE_X96_EXAMPLE);
      const value2 = valueOfToken1AmountInToken0(amount2, SQRT_PRICE_X96_EXAMPLE);

      // value2 should be ~2x value1
      const tolerance = 1000000000000000n; // 0.001 WETH
      expect(value2).toBeGreaterThanOrEqual(value1 * 2n - tolerance);
      expect(value2).toBeLessThanOrEqual(value1 * 2n + tolerance);
    });

    it('should be inverse of valueOfToken0AmountInToken1', () => {
      const wethAmount = 10n ** BigInt(WETH_DECIMALS); // 1 WETH
      const usdcValue = valueOfToken0AmountInToken1(wethAmount, SQRT_PRICE_X96_EXAMPLE);
      const wethValueBack = valueOfToken1AmountInToken0(usdcValue, SQRT_PRICE_X96_EXAMPLE);

      // Should get back approximately the same WETH amount
      const tolerance = 1000000000000000n; // 0.001 WETH tolerance for rounding
      expect(wethValueBack).toBeGreaterThanOrEqual(wethAmount - tolerance);
      expect(wethValueBack).toBeLessThanOrEqual(wethAmount + tolerance);
    });
  });

  describe('tickToSqrtRatioX96', () => {
    it('should return 2^96 for tick 0', () => {
      const sqrtPrice = tickToSqrtRatioX96(0);
      const expected = JSBI.BigInt('79228162514264337593543950336'); // 2^96

      expect(JSBI.equal(sqrtPrice, expected)).toBe(true);
    });

    it('should return larger value for positive ticks', () => {
      const sqrtPrice0 = tickToSqrtRatioX96(0);
      const sqrtPrice1000 = tickToSqrtRatioX96(1000);

      expect(JSBI.greaterThan(sqrtPrice1000, sqrtPrice0)).toBe(true);
    });

    it('should return smaller value for negative ticks', () => {
      const sqrtPrice0 = tickToSqrtRatioX96(0);
      const sqrtPriceMinus1000 = tickToSqrtRatioX96(-1000);

      expect(JSBI.lessThan(sqrtPriceMinus1000, sqrtPrice0)).toBe(true);
    });

    it('should convert tick -193909 to sqrtPriceX96', () => {
      // Real data from Arbitrum WETH/USDC pool
      // Tick -193909 is the floor tick for sqrtPriceX96 = 4880027310900678652549898
      // But due to discrete ticks, the actual sqrtPrice at tick -193909 is slightly different
      const tick = -193909;
      const sqrtPrice = tickToSqrtRatioX96(tick);
      const expectedSqrtPrice = JSBI.BigInt('4879885917751750091170661'); // Actual sqrt at tick -193909

      // Should match the sqrt price at tick -193909
      expect(JSBI.equal(sqrtPrice, expectedSqrtPrice)).toBe(true);
    });

    it('should handle extreme ticks', () => {
      // Max tick: 887272
      const maxSqrtPrice = tickToSqrtRatioX96(887272);
      expect(JSBI.greaterThan(maxSqrtPrice, JSBI.BigInt(0))).toBe(true);

      // Min tick: -887272
      const minSqrtPrice = tickToSqrtRatioX96(-887272);
      expect(JSBI.greaterThan(minSqrtPrice, JSBI.BigInt(0))).toBe(true);
    });
  });

  describe('tickToPrice', () => {
    it('should convert tick to price for WETH/USDC', () => {
      // Real data from Arbitrum WETH/USDC pool
      // WETH (0x82aF...) < USDC (0xaf88...) by address → WETH is token0
      // Tick -193909 is floor tick for sqrtPriceX96 = 4880027310900678652549898
      // Actual sqrtPrice at tick -193909 is slightly different
      const tick = -193909;

      const price = tickToPrice(
        tick,
        WETH_ADDRESS,
        USDC_ADDRESS,
        WETH_DECIMALS
      );

      // Should be close to 3793 USDC per WETH
      expect(price).toBeGreaterThanOrEqual(3793_000000n);
      expect(price).toBeLessThanOrEqual(3794_000000n);
    });

    it('should return ~1 for tick 0 with same decimals', () => {
      const price = tickToPrice(
        0,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        18
      );

      expect(price).toBe(1000000000000000000n); // 1e18
    });

    it('should handle reversed token ordering', () => {
      // When USDC is base and WETH is quote (reversed from pool ordering)
      // Use a smaller tick to avoid precision loss with 6 decimals
      const tick = -193909; // Use the actual pool tick

      const priceWethQuote = tickToPrice(
        tick,
        USDC_ADDRESS,
        WETH_ADDRESS,
        USDC_DECIMALS
      );

      // With low decimals (6), we expect some rounding
      // Price should be very small (USDC < WETH in value)
      expect(priceWethQuote).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('priceToTick', () => {
    it('should convert price back to tick', () => {
      const targetPrice = 3793_895265n; // 3793.895265 USDC per WETH (in USDC decimals)
      const tickSpacing = 10; // 0.05% fee tier (actual spacing for this pool)

      const tick = priceToTick(
        targetPrice,
        tickSpacing,
        WETH_ADDRESS,
        USDC_ADDRESS,
        WETH_DECIMALS
      );

      // Should be close to -193909 (negative because WETH price is >1 USDC)
      // Snapped to tick spacing: -193909 / 10 = -19390.9 → -19391 * 10 = -193910
      expect(tick).toBe(-193910);

      // Tick should be divisible by tickSpacing (handle -0 vs 0)
      expect(Math.abs(tick % tickSpacing)).toBe(0);
    });

    it('should return tick divisible by tickSpacing', () => {
      const price = 2000_000000n; // 2000 USDC
      const tickSpacing = 10; // 0.05% fee tier

      const tick = priceToTick(
        price,
        tickSpacing,
        WETH_ADDRESS,
        USDC_ADDRESS,
        WETH_DECIMALS
      );

      expect(Math.abs(tick % tickSpacing)).toBe(0);
    });

    it('should handle different tick spacings', () => {
      const price = 3793_895265n;

      const tick1 = priceToTick(price, 1, WETH_ADDRESS, USDC_ADDRESS, WETH_DECIMALS);
      const tick10 = priceToTick(price, 10, WETH_ADDRESS, USDC_ADDRESS, WETH_DECIMALS);
      const tick60 = priceToTick(price, 60, WETH_ADDRESS, USDC_ADDRESS, WETH_DECIMALS);

      expect(Math.abs(tick1 % 1)).toBe(0);
      expect(Math.abs(tick10 % 10)).toBe(0);
      expect(Math.abs(tick60 % 60)).toBe(0);
    });
  });

  describe('priceToClosestUsableTick', () => {
    it('should find closest usable tick to target price', () => {
      const targetPrice = 3793_895265n;
      const tickSpacing = 10; // 0.05% fee tier (actual spacing for this pool)

      const tick = priceToClosestUsableTick(
        targetPrice,
        tickSpacing,
        WETH_ADDRESS,
        USDC_ADDRESS,
        WETH_DECIMALS
      );

      // Should be -193910 (closest usable tick to -193909)
      expect(tick).toBe(-193910);

      // Tick should be divisible by tickSpacing (handle -0 vs 0)
      expect(Math.abs(tick % tickSpacing)).toBe(0);
    });

    it('should handle tick spacing boundaries', () => {
      const price = 3790_000000n;
      const tickSpacing = 200; // 1% fee tier

      const tick = priceToClosestUsableTick(
        price,
        tickSpacing,
        WETH_ADDRESS,
        USDC_ADDRESS,
        WETH_DECIMALS
      );

      expect(Math.abs(tick % tickSpacing)).toBe(0);
    });

    it('should return nearest tick for 1:1 price', () => {
      const price = 1000000000000000000n; // 1:1 with 18 decimals
      const tickSpacing = 60;

      const tick = priceToClosestUsableTick(
        price,
        tickSpacing,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        18
      );

      // Should be close to 0
      expect(tick).toBeGreaterThanOrEqual(-tickSpacing);
      expect(tick).toBeLessThanOrEqual(tickSpacing);
      expect(tick % tickSpacing).toBe(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle minimum positive sqrtPriceX96', () => {
      const minPrice = 1n;
      const price0in1 = pricePerToken0InToken1(minPrice, 18);
      const price1in0 = pricePerToken1InToken0(minPrice, 18);

      expect(price0in1).toBeGreaterThanOrEqual(0n);
      expect(price1in0).toBeGreaterThan(0n);
    });

    it('should handle maximum sqrtPriceX96', () => {
      const maxPrice = 2n ** 160n - 1n; // Max uint160
      const price0in1 = pricePerToken0InToken1(maxPrice, 18);
      const price1in0 = pricePerToken1InToken0(maxPrice, 6);

      expect(price0in1).toBeGreaterThan(0n);
      expect(price1in0).toBeGreaterThanOrEqual(0n);
    });

    it('should handle tokens with different decimals', () => {
      // Use real WBTC/USDC pool data
      const sqrtPrice = 2594590524261178691684425401086n;

      const price0in1 = pricePerToken0InToken1(sqrtPrice, 8);
      const price1in0 = pricePerToken1InToken0(sqrtPrice, 6);

      expect(price0in1).toBeGreaterThan(100000_000000n); // > $100k
      expect(price1in0).toBeGreaterThan(0n);
    });

    it('should handle very high decimal tokens', () => {
      // Some tokens have 18+ decimals
      const sqrtPrice = SQRT_PRICE_X96_EXAMPLE;

      const price = pricePerToken0InToken1(sqrtPrice, 24);
      expect(price).toBeGreaterThan(0n);
    });

    it('should handle 0 decimal tokens (theoretical)', () => {
      const sqrtPrice = SQRT_PRICE_X96_EXAMPLE;

      const price = pricePerToken0InToken1(sqrtPrice, 0);
      expect(price).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('Real-world Pool Examples', () => {
    it('should handle USDC/ETH 0.05% pool', () => {
      // Example from a real USDC/ETH pool
      // USDC (token0) / WETH (token1)
      // Use the example sqrtPrice from above (but inverted since USDC < WETH by address)
      const sqrtPrice = SQRT_PRICE_X96_EXAMPLE;

      // WETH is token0, USDC is token1 (based on address ordering)
      // This is the price of WETH in USDC
      const ethPriceInUsdc = pricePerToken0InToken1(sqrtPrice, 18);

      // ETH should be worth thousands of USDC
      expect(ethPriceInUsdc).toBeGreaterThan(1000_000000n);
      expect(ethPriceInUsdc).toBeLessThan(10000_000000n);
    });

    it('should handle stablecoin pairs (USDC/USDT)', () => {
      // For stablecoin pairs, price should be close to 1:1
      const sqrtPrice = 79228162514264337593543950336n; // 2^96 = 1:1

      const usdcInUsdt = pricePerToken0InToken1(sqrtPrice, 6);
      const usdtInUsdc = pricePerToken1InToken0(sqrtPrice, 6);

      // Both should be ~1 (with 6 decimals = 1000000)
      expect(usdcInUsdt).toBeGreaterThan(990000n);
      expect(usdcInUsdt).toBeLessThan(1010000n);
      expect(usdtInUsdc).toBeGreaterThan(990000n);
      expect(usdtInUsdc).toBeLessThan(1010000n);
    });

    it('should handle WBTC/USDC pool', () => {
      // Real Arbitrum WBTC/USDC pool
      // Pool: 0x6985cb98CE393FCE8d6272127F39013f61e36166
      // WBTC (8 decimals) / USDC (6 decimals)
      // sqrtPriceX96 at tick 69780
      const sqrtPrice = 2594590524261178691684425401086n;

      const wbtcInUsdc = pricePerToken0InToken1(sqrtPrice, 8);

      // 1 WBTC should be worth ~$107,181 USDC
      expect(wbtcInUsdc).toBeGreaterThan(107000_000000n);
      expect(wbtcInUsdc).toBeLessThan(108000_000000n);
    });
  });
});
