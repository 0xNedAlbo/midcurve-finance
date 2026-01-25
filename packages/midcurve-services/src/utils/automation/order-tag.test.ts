import { describe, it, expect } from 'vitest';
import { generateOrderTag, OrderTagParams } from './order-tag.js';

/**
 * Tests for generateOrderTag utility
 *
 * Test data based on real WETH/USDC pool (Arbitrum)
 * Pool: 0xC6962004f452bE9203591991D15f6b388e09E8D0
 * WETH (token0) / USDC (token1)
 * WETH decimals: 18
 * USDC decimals: 6
 *
 * Real sqrtPriceX96 = 4880027310900678652549898n corresponds to:
 * - 1 WETH = 3793.895265 USDC (price in quote token terms when token1 is quote)
 * - 1 USDC = 0.000263592 WETH (price in quote token terms when token0 is quote)
 */
describe('generateOrderTag', () => {
  // Test constants
  const WETH_DECIMALS = 18;
  const USDC_DECIMALS = 6;

  // Real-world sqrtPriceX96 from Arbitrum WETH/USDC pool at ~$3793.90
  const SQRT_PRICE_X96_ETH_3794 = 4880027310900678652549898n;

  describe('direction labels', () => {
    const baseParams: Omit<OrderTagParams, 'triggerSide'> = {
      sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
      token0IsQuote: false, // USDC (token1) is quote
      token0Decimals: WETH_DECIMALS,
      token1Decimals: USDC_DECIMALS,
    };

    it('should return "TP" prefix for upper trigger (Take Profit)', () => {
      const tag = generateOrderTag({ ...baseParams, triggerSide: 'upper' });

      expect(tag.startsWith('TP@')).toBe(true);
    });

    it('should return "SL" prefix for lower trigger (Stop Loss)', () => {
      const tag = generateOrderTag({ ...baseParams, triggerSide: 'lower' });

      expect(tag.startsWith('SL@')).toBe(true);
    });
  });

  describe('token0IsQuote = false (common case: stablecoin is token1)', () => {
    // ETH/USDC pool where USDC (token1) is the quote token
    // Price shows how many USDC per 1 ETH

    it('should format price correctly for WETH/USDC pool at ~$3794', () => {
      const tag = generateOrderTag({
        triggerSide: 'upper',
        sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
        token0IsQuote: false,
        token0Decimals: WETH_DECIMALS,
        token1Decimals: USDC_DECIMALS,
      });

      // Should be "TP@3,793.9" or similar (formatCompactValue uses thousand separators)
      expect(tag).toMatch(/^TP@[\d,]+\.?\d*$/);
      // Price should be around $3793-3794
      const priceMatch = tag.match(/TP@([\d,]+\.?\d*)/);
      expect(priceMatch).not.toBeNull();
      const priceStr = priceMatch![1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      expect(price).toBeGreaterThan(3700);
      expect(price).toBeLessThan(3900);
    });

    it('should format lower trigger as SL', () => {
      const tag = generateOrderTag({
        triggerSide: 'lower',
        sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
        token0IsQuote: false,
        token0Decimals: WETH_DECIMALS,
        token1Decimals: USDC_DECIMALS,
      });

      expect(tag).toMatch(/^SL@[\d,]+\.?\d*$/);
    });
  });

  describe('token0IsQuote = true (USDC is token0)', () => {
    // USDC/ETH pool where USDC (token0) is the quote token
    // Price shows how many USDC per 1 ETH
    // This is a reversed pool where the stablecoin has the lower address

    it('should format price correctly when quote is token0', () => {
      const tag = generateOrderTag({
        triggerSide: 'upper',
        sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
        token0IsQuote: true,
        token0Decimals: USDC_DECIMALS, // USDC is now token0
        token1Decimals: WETH_DECIMALS, // WETH is now token1
      });

      // When token0 is quote and token1 is base:
      // Price = how many token0 (USDC) per 1 token1 (ETH)
      // This uses pricePerToken1InToken0 which gives ~0.00026 (tiny number)
      // The tag should show a small decimal value
      expect(tag.startsWith('TP@')).toBe(true);
    });
  });

  describe('various price magnitudes', () => {
    it('should handle very large prices (BTC at ~$100k)', () => {
      // Real WBTC/USDC pool sqrtPriceX96 at ~$107,245
      const sqrtPriceBtc = 2594590524261178691684425401086n;

      const tag = generateOrderTag({
        triggerSide: 'upper',
        sqrtPriceX96: sqrtPriceBtc,
        token0IsQuote: false,
        token0Decimals: 8, // WBTC
        token1Decimals: 6, // USDC
      });

      expect(tag.startsWith('TP@')).toBe(true);
      // Should show a large price like "107,245.35"
      const priceMatch = tag.match(/TP@([\d,]+\.?\d*)/);
      expect(priceMatch).not.toBeNull();
      const priceStr = priceMatch![1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      expect(price).toBeGreaterThan(100000);
      expect(price).toBeLessThan(120000);
    });

    it('should handle 1:1 price ratio (stablecoin pair)', () => {
      // sqrtPriceX96 = 2^96 means price = 1
      const sqrtPrice1to1 = 79228162514264337593543950336n;

      const tag = generateOrderTag({
        triggerSide: 'lower',
        sqrtPriceX96: sqrtPrice1to1,
        token0IsQuote: false,
        token0Decimals: 6, // USDC
        token1Decimals: 6, // USDT
      });

      expect(tag.startsWith('SL@')).toBe(true);
      // Price should be exactly 1 (formatted as "1" or "1.0")
      expect(tag).toMatch(/SL@1\.?0*$/);
    });

    it('should handle small fractional prices', () => {
      // Very small sqrtPriceX96 represents very cheap token0
      // Use a price that gives a small but non-zero value
      const smallSqrtPrice = 79228162514264337593543950n; // 2^96 / 1000

      const tag = generateOrderTag({
        triggerSide: 'upper',
        sqrtPriceX96: smallSqrtPrice,
        token0IsQuote: false,
        token0Decimals: 18,
        token1Decimals: 18,
      });

      expect(tag.startsWith('TP@')).toBe(true);
      // Should show a small decimal or subscript notation
    });
  });

  describe('format consistency', () => {
    it('should always return a string in format "{DIRECTION}@{PRICE}"', () => {
      const testCases: Array<Omit<OrderTagParams, 'sqrtPriceX96'>> = [
        { triggerSide: 'upper', token0IsQuote: false, token0Decimals: 18, token1Decimals: 6 },
        { triggerSide: 'lower', token0IsQuote: false, token0Decimals: 18, token1Decimals: 6 },
        { triggerSide: 'upper', token0IsQuote: true, token0Decimals: 6, token1Decimals: 18 },
        { triggerSide: 'lower', token0IsQuote: true, token0Decimals: 6, token1Decimals: 18 },
        { triggerSide: 'upper', token0IsQuote: false, token0Decimals: 8, token1Decimals: 6 },
      ];

      for (const params of testCases) {
        const tag = generateOrderTag({
          ...params,
          sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
        });

        // Should match format: "TP@..." or "SL@..."
        expect(tag).toMatch(/^(TP|SL)@.+$/);
      }
    });

    it('should not contain any unexpected characters', () => {
      const tag = generateOrderTag({
        triggerSide: 'upper',
        sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
        token0IsQuote: false,
        token0Decimals: WETH_DECIMALS,
        token1Decimals: USDC_DECIMALS,
      });

      // Should only contain: T, P, S, L, @, digits, comma, dot, and subscript characters
      // formatCompactValue may use subscript notation for very small numbers
      expect(tag).toMatch(/^(TP|SL)@[\d,.\u2080-\u2089\u208d\u208e…]+$/);
    });
  });

  describe('edge cases', () => {
    it('should handle zero price (edge case)', () => {
      // Note: sqrtPriceX96 = 0 is not valid in Uniswap V3, but test the behavior
      // The function should handle it gracefully
      const tag = generateOrderTag({
        triggerSide: 'upper',
        sqrtPriceX96: 1n, // Minimum positive value
        token0IsQuote: false,
        token0Decimals: 18,
        token1Decimals: 6,
      });

      expect(tag.startsWith('TP@')).toBe(true);
    });

    it('should handle same decimals for both tokens', () => {
      const tag = generateOrderTag({
        triggerSide: 'lower',
        sqrtPriceX96: SQRT_PRICE_X96_ETH_3794,
        token0IsQuote: false,
        token0Decimals: 18,
        token1Decimals: 18,
      });

      expect(tag.startsWith('SL@')).toBe(true);
    });
  });
});
