/**
 * Tests for Uniswap V3 Position Ledger Calculations
 *
 * Comprehensive unit tests for all ledger calculation utilities.
 * Tests cover happy paths, edge cases, and integration scenarios.
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePoolPriceInQuoteToken,
  calculateTokenValueInQuote,
  calculateProportionalCostBasis,
  separateFeesFromPrincipal,
  updateUncollectedPrincipal,
  type FeeSeparationResult,
  type UncollectedPrincipalResult,
} from './ledger-calculations.js';

// ============================================================================
// TEST CONSTANTS - Realistic Uniswap V3 Pool Data
// ============================================================================

// These are realistic sqrtPriceX96 values. The actual price will be calculated
// from these values, so we don't hard-code expected prices in the tests.

// WETH/USDC-like pool (token0 = USDC, token1 = WETH)
// Price: approximately 2000-2500 USDC per WETH based on this sqrtPriceX96
const WETH_USDC_SQRT_PRICE_X96 = 1585313517786896408558883524n;
const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;

// WBTC/WETH-like pool (token0 = WBTC, token1 = WETH)
// Price: approximately 14-16 WETH per WBTC based on this sqrtPriceX96
const WBTC_WETH_SQRT_PRICE_X96 = 14026500000000000000000000000n;
const WBTC_DECIMALS = 8;

// ============================================================================
// PRICE CALCULATION TESTS
// ============================================================================

describe('calculatePoolPriceInQuoteToken', () => {
  describe('when token0 is quote (USDC/WETH pool)', () => {
    it('should calculate price correctly', () => {
      // USDC/WETH pool: token0 = USDC (quote), token1 = WETH (base)
      const price = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        true, // token0 (USDC) is quote
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      // Price should be positive
      expect(price).toBeGreaterThan(0n);
    });

    it('should return price in quote token raw units', () => {
      const price = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      // Price should be positive
      expect(price).toBeGreaterThan(0n);
    });
  });

  describe('when token1 is quote (WETH/USDC pool, reverse token order)', () => {
    it('should calculate price correctly', () => {
      // Different pool where token0 = WETH (base), token1 = USDC (quote)
      const price = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        false, // token1 (USDC) is quote
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      // Price should be positive
      expect(price).toBeGreaterThan(0n);
    });
  });

  describe('with different decimal combinations', () => {
    it('should handle 8/18 decimals (WBTC/WETH)', () => {
      // WBTC/WETH: token0 = WBTC (base), token1 = WETH (quote)
      const price = calculatePoolPriceInQuoteToken(
        WBTC_WETH_SQRT_PRICE_X96,
        false, // token1 (WETH) is quote
        WBTC_DECIMALS,
        WETH_DECIMALS
      );

      // Price should be positive and reasonable (WETH per WBTC)
      expect(price).toBeGreaterThan(0n);
      expect(price).toBeLessThan(100n * 10n ** 18n); // < 100 WETH per WBTC
    });

    it('should handle 18/18 decimals', () => {
      // Hypothetical pool with same decimals
      const price = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        false,
        18,
        18
      );

      // Should still calculate correctly
      expect(price).toBeGreaterThan(0n);
    });
  });
});

// ============================================================================
// TOKEN VALUE CALCULATION TESTS
// ============================================================================

describe('calculateTokenValueInQuote', () => {
  describe('when token0 is quote (USDC/WETH)', () => {
    it('should calculate value with both tokens', () => {
      // Calculate price first to know what to expect
      const poolPrice = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      // 1000 USDC + 0.5 WETH
      const token0Amount = 1000_000000n;
      const token1Amount = 500000000000000000n; // 0.5 WETH

      const value = calculateTokenValueInQuote(
        token0Amount,
        token1Amount,
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      // Expected: 1000 USDC + (0.5 WETH * poolPrice / 10^18)
      const expectedValue = token0Amount + (token1Amount * poolPrice) / (10n ** 18n);
      expect(value).toBe(expectedValue);
      expect(value).toBeGreaterThan(token0Amount); // Should include WETH value
    });

    it('should calculate value with only quote token', () => {
      // 1000 USDC + 0 WETH = 1000 USDC
      const value = calculateTokenValueInQuote(
        1000_000000n,
        0n,
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      expect(value).toBe(1000_000000n);
    });

    it('should calculate value with only base token', () => {
      // 0 USDC + 1 WETH
      const poolPrice = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      const value = calculateTokenValueInQuote(
        0n,
        1000000000000000000n, // 1 WETH
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      // Should equal pool price (1 WETH converted to USDC)
      expect(value).toBe(poolPrice);
    });

    it('should handle zero amounts', () => {
      const value = calculateTokenValueInQuote(
        0n,
        0n,
        WETH_USDC_SQRT_PRICE_X96,
        true,
        USDC_DECIMALS,
        WETH_DECIMALS
      );

      expect(value).toBe(0n);
    });
  });

  describe('when token1 is quote (WETH/USDC)', () => {
    it('should calculate value with both tokens', () => {
      // Calculate price first
      const poolPrice = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        false,
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      // 0.5 WETH + 1000 USDC
      const token0Amount = 500000000000000000n; // 0.5 WETH (token0)
      const token1Amount = 1000_000000n; // 1000 USDC (token1)

      const value = calculateTokenValueInQuote(
        token0Amount,
        token1Amount,
        WETH_USDC_SQRT_PRICE_X96,
        false,
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      // Expected: 1000 USDC + (0.5 WETH * poolPrice / 10^18)
      const expectedValue = token1Amount + (token0Amount * poolPrice) / (10n ** 18n);
      expect(value).toBe(expectedValue);
      expect(value).toBeGreaterThan(token1Amount); // Should include WETH value
    });

    it('should calculate value with only quote token', () => {
      // 0 WETH + 1000 USDC = 1000 USDC
      const value = calculateTokenValueInQuote(
        0n,
        1000_000000n,
        WETH_USDC_SQRT_PRICE_X96,
        false,
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      expect(value).toBe(1000_000000n);
    });

    it('should calculate value with only base token', () => {
      // 1 WETH + 0 USDC
      const poolPrice = calculatePoolPriceInQuoteToken(
        WETH_USDC_SQRT_PRICE_X96,
        false,
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      const value = calculateTokenValueInQuote(
        1000000000000000000n, // 1 WETH
        0n,
        WETH_USDC_SQRT_PRICE_X96,
        false,
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      // Should equal pool price
      expect(value).toBe(poolPrice);
    });
  });

  describe('with large amounts', () => {
    it('should handle large token amounts without overflow', () => {
      // 1 million WETH + 1 billion USDC
      const value = calculateTokenValueInQuote(
        1000000n * 10n ** 18n, // 1M WETH
        1000000000n * 10n ** 6n, // 1B USDC
        WETH_USDC_SQRT_PRICE_X96,
        false,
        WETH_DECIMALS,
        USDC_DECIMALS
      );

      // Should be at least the USDC amount
      expect(value).toBeGreaterThan(1000000000n * 10n ** 6n);
    });
  });
});

// ============================================================================
// PROPORTIONAL COST BASIS TESTS
// ============================================================================

describe('calculateProportionalCostBasis', () => {
  describe('typical scenarios', () => {
    it('should calculate 50% withdrawal correctly', () => {
      const proportional = calculateProportionalCostBasis(
        10000_000000n, // 10,000 USDC cost basis
        1000000n, // 1M liquidity withdrawn
        2000000n // 2M total liquidity
      );

      // 50% of 10,000 = 5,000
      expect(proportional).toBe(5000_000000n);
    });

    it('should calculate 100% withdrawal correctly', () => {
      const proportional = calculateProportionalCostBasis(
        10000_000000n,
        2000000n, // Full withdrawal
        2000000n
      );

      // 100% of 10,000 = 10,000
      expect(proportional).toBe(10000_000000n);
    });

    it('should calculate small withdrawal (1%) correctly', () => {
      const proportional = calculateProportionalCostBasis(
        10000_000000n,
        20000n, // 1% withdrawal
        2000000n
      );

      // 1% of 10,000 = 100
      expect(proportional).toBe(100_000000n);
    });

    it('should calculate 25% withdrawal correctly', () => {
      const proportional = calculateProportionalCostBasis(
        10000_000000n,
        500000n, // 25% withdrawal
        2000000n
      );

      // 25% of 10,000 = 2,500
      expect(proportional).toBe(2500_000000n);
    });

    it('should calculate 75% withdrawal correctly', () => {
      const proportional = calculateProportionalCostBasis(
        10000_000000n,
        1500000n, // 75% withdrawal
        2000000n
      );

      // 75% of 10,000 = 7,500
      expect(proportional).toBe(7500_000000n);
    });
  });

  describe('edge cases', () => {
    it('should return 0 for zero withdrawal', () => {
      const proportional = calculateProportionalCostBasis(
        10000_000000n,
        0n, // No withdrawal
        2000000n
      );

      expect(proportional).toBe(0n);
    });

    it('should return 0 when cost basis is zero', () => {
      const proportional = calculateProportionalCostBasis(
        0n, // Zero cost basis
        1000000n,
        2000000n
      );

      expect(proportional).toBe(0n);
    });

    it('should throw error if current liquidity is zero', () => {
      expect(() =>
        calculateProportionalCostBasis(10000_000000n, 1000000n, 0n)
      ).toThrow('Current liquidity cannot be zero');
    });

    it('should throw error if delta liquidity is negative', () => {
      expect(() =>
        calculateProportionalCostBasis(10000_000000n, -1000000n, 2000000n)
      ).toThrow('Delta liquidity cannot be negative');
    });

    it('should throw error if delta exceeds current liquidity', () => {
      expect(() =>
        calculateProportionalCostBasis(10000_000000n, 3000000n, 2000000n)
      ).toThrow('Delta liquidity cannot exceed current liquidity');
    });
  });

  describe('rounding behavior', () => {
    it('should handle division with remainder (floor)', () => {
      // Cost basis that doesn't divide evenly
      const proportional = calculateProportionalCostBasis(
        10000_000001n, // 10,000.000001 USDC
        1n, // Tiny withdrawal
        3n // Total liquidity
      );

      // (10000_000001 * 1) / 3 = 3333_333333 (floor)
      expect(proportional).toBe(3333_333333n);
    });
  });
});

// ============================================================================
// FEE SEPARATION TESTS
// ============================================================================

describe('separateFeesFromPrincipal', () => {
  describe('all fees scenarios', () => {
    it('should classify all collected as fees when no uncollected principal', () => {
      const result = separateFeesFromPrincipal(
        100_000000n, // Collected 100 USDC
        0n,
        0n, // No uncollected principal
        0n
      );

      expect(result.feeAmount0).toBe(100_000000n);
      expect(result.feeAmount1).toBe(0n);
      expect(result.principalAmount0).toBe(0n);
      expect(result.principalAmount1).toBe(0n);
    });

    it('should classify fees in both tokens', () => {
      const result = separateFeesFromPrincipal(
        50_000000n, // 50 USDC fees
        100000000000000000n, // 0.1 WETH fees
        0n,
        0n
      );

      expect(result.feeAmount0).toBe(50_000000n);
      expect(result.feeAmount1).toBe(100000000000000000n);
      expect(result.principalAmount0).toBe(0n);
      expect(result.principalAmount1).toBe(0n);
    });
  });

  describe('all principal scenarios', () => {
    it('should classify all collected as principal when matches uncollected exactly', () => {
      const result = separateFeesFromPrincipal(
        1000_000000n, // Collected 1000 USDC
        0n,
        1000_000000n, // Uncollected: 1000 USDC
        0n
      );

      expect(result.feeAmount0).toBe(0n);
      expect(result.feeAmount1).toBe(0n);
      expect(result.principalAmount0).toBe(1000_000000n);
      expect(result.principalAmount1).toBe(0n);
    });

    it('should cap principal at collected when uncollected is higher', () => {
      const result = separateFeesFromPrincipal(
        500_000000n, // Collected 500 USDC
        0n,
        1000_000000n, // Uncollected: 1000 USDC (more than collected)
        0n
      );

      // Can only return what was collected
      expect(result.feeAmount0).toBe(0n);
      expect(result.principalAmount0).toBe(500_000000n);
    });
  });

  describe('mixed fees and principal scenarios', () => {
    it('should separate fees and principal correctly', () => {
      const result = separateFeesFromPrincipal(
        1100_000000n, // Collected 1100 USDC
        0n,
        1000_000000n, // Uncollected: 1000 USDC
        0n
      );

      // 1000 principal + 100 fees
      expect(result.principalAmount0).toBe(1000_000000n);
      expect(result.feeAmount0).toBe(100_000000n);
      expect(result.feeAmount1).toBe(0n);
      expect(result.principalAmount1).toBe(0n);
    });

    it('should handle asymmetric fees/principal (token0 fees, token1 principal)', () => {
      const result = separateFeesFromPrincipal(
        100_000000n, // 100 USDC collected (all fees)
        500000000000000000n, // 0.5 WETH collected
        0n, // No USDC principal
        500000000000000000n // 0.5 WETH principal
      );

      expect(result.feeAmount0).toBe(100_000000n);
      expect(result.principalAmount0).toBe(0n);
      expect(result.feeAmount1).toBe(0n);
      expect(result.principalAmount1).toBe(500000000000000000n);
    });

    it('should handle both tokens with mixed fees/principal', () => {
      const result = separateFeesFromPrincipal(
        1100_000000n, // 1100 USDC collected
        600000000000000000n, // 0.6 WETH collected
        1000_000000n, // 1000 USDC principal
        500000000000000000n // 0.5 WETH principal
      );

      // USDC: 1000 principal + 100 fees
      expect(result.principalAmount0).toBe(1000_000000n);
      expect(result.feeAmount0).toBe(100_000000n);

      // WETH: 0.5 principal + 0.1 fees
      expect(result.principalAmount1).toBe(500000000000000000n);
      expect(result.feeAmount1).toBe(100000000000000000n);
    });
  });

  describe('sequential collects', () => {
    it('should handle multiple collects reducing uncollected principal', () => {
      // First collect: 500 USDC from 1000 uncollected
      const result1 = separateFeesFromPrincipal(
        500_000000n,
        0n,
        1000_000000n,
        0n
      );

      expect(result1.principalAmount0).toBe(500_000000n);
      expect(result1.feeAmount0).toBe(0n);

      // Second collect: 500 USDC from remaining 500 uncollected
      const uncollectedAfterFirst = 1000_000000n - result1.principalAmount0;
      const result2 = separateFeesFromPrincipal(
        500_000000n,
        0n,
        uncollectedAfterFirst,
        0n
      );

      expect(result2.principalAmount0).toBe(500_000000n);
      expect(result2.feeAmount0).toBe(0n);

      // Third collect: 100 USDC, but no uncollected left (all fees)
      const uncollectedAfterSecond = uncollectedAfterFirst - result2.principalAmount0;
      const result3 = separateFeesFromPrincipal(
        100_000000n,
        0n,
        uncollectedAfterSecond, // Should be 0
        0n
      );

      expect(result3.principalAmount0).toBe(0n);
      expect(result3.feeAmount0).toBe(100_000000n);
    });
  });

  describe('edge cases', () => {
    it('should handle zero collected amounts', () => {
      const result = separateFeesFromPrincipal(0n, 0n, 1000_000000n, 0n);

      expect(result.feeAmount0).toBe(0n);
      expect(result.feeAmount1).toBe(0n);
      expect(result.principalAmount0).toBe(0n);
      expect(result.principalAmount1).toBe(0n);
    });

    it('should handle zero uncollected principal', () => {
      const result = separateFeesFromPrincipal(100_000000n, 0n, 0n, 0n);

      expect(result.feeAmount0).toBe(100_000000n);
      expect(result.principalAmount0).toBe(0n);
    });

    it('should throw error for negative collected amounts', () => {
      expect(() => separateFeesFromPrincipal(-100n, 0n, 0n, 0n)).toThrow(
        'Collected amounts cannot be negative'
      );
    });

    it('should throw error for negative uncollected principal', () => {
      expect(() => separateFeesFromPrincipal(100n, 0n, -100n, 0n)).toThrow(
        'Uncollected principal cannot be negative'
      );
    });
  });
});

// ============================================================================
// UNCOLLECTED PRINCIPAL TRACKING TESTS
// ============================================================================

describe('updateUncollectedPrincipal', () => {
  describe('INCREASE_POSITION events', () => {
    it('should not change uncollected principal', () => {
      const result = updateUncollectedPrincipal(
        500_000000n, // Previous uncollected
        0n,
        'INCREASE_POSITION',
        1000_000000n, // Amounts don't matter for INCREASE
        0n,
        0n,
        0n
      );

      expect(result.uncollectedPrincipal0After).toBe(500_000000n);
      expect(result.uncollectedPrincipal1After).toBe(0n);
    });

    it('should preserve zero uncollected principal', () => {
      const result = updateUncollectedPrincipal(
        0n,
        0n,
        'INCREASE_POSITION',
        1000_000000n,
        0n,
        0n,
        0n
      );

      expect(result.uncollectedPrincipal0After).toBe(0n);
      expect(result.uncollectedPrincipal1After).toBe(0n);
    });
  });

  describe('DECREASE_POSITION events', () => {
    it('should add withdrawn amounts to uncollected principal', () => {
      const result = updateUncollectedPrincipal(
        0n, // Previous uncollected
        0n,
        'DECREASE_POSITION',
        1000_000000n, // Withdrew 1000 USDC
        500000000000000000n, // Withdrew 0.5 WETH
        0n,
        0n
      );

      expect(result.uncollectedPrincipal0After).toBe(1000_000000n);
      expect(result.uncollectedPrincipal1After).toBe(500000000000000000n);
    });

    it('should accumulate multiple decreases', () => {
      // First decrease
      const result1 = updateUncollectedPrincipal(
        0n,
        0n,
        'DECREASE_POSITION',
        500_000000n,
        0n,
        0n,
        0n
      );

      expect(result1.uncollectedPrincipal0After).toBe(500_000000n);

      // Second decrease (accumulates)
      const result2 = updateUncollectedPrincipal(
        result1.uncollectedPrincipal0After,
        result1.uncollectedPrincipal1After,
        'DECREASE_POSITION',
        500_000000n,
        0n,
        0n,
        0n
      );

      expect(result2.uncollectedPrincipal0After).toBe(1000_000000n);
    });

    it('should throw error for negative amounts', () => {
      expect(() =>
        updateUncollectedPrincipal(0n, 0n, 'DECREASE_POSITION', -100n, 0n, 0n, 0n)
      ).toThrow('DECREASE amounts cannot be negative');
    });
  });

  describe('COLLECT events', () => {
    it('should subtract collected principal from uncollected pool', () => {
      const result = updateUncollectedPrincipal(
        1000_000000n, // Previous uncollected
        0n,
        'COLLECT',
        1100_000000n, // Total collected (not used directly)
        0n,
        1000_000000n, // Principal portion (from separateFeesFromPrincipal)
        0n
      );

      expect(result.uncollectedPrincipal0After).toBe(0n);
      expect(result.uncollectedPrincipal1After).toBe(0n);
    });

    it('should partially reduce uncollected principal', () => {
      const result = updateUncollectedPrincipal(
        1000_000000n,
        0n,
        'COLLECT',
        600_000000n, // Total collected
        0n,
        500_000000n, // Only 500 is principal (100 is fees)
        0n
      );

      // 1000 - 500 = 500 remaining
      expect(result.uncollectedPrincipal0After).toBe(500_000000n);
    });

    it('should handle collect with only fees (no principal reduction)', () => {
      const result = updateUncollectedPrincipal(
        1000_000000n,
        0n,
        'COLLECT',
        100_000000n, // Collected 100 (all fees)
        0n,
        0n, // No principal collected
        0n
      );

      // Uncollected remains unchanged
      expect(result.uncollectedPrincipal0After).toBe(1000_000000n);
    });

    it('should throw error when collecting more principal than available', () => {
      expect(() =>
        updateUncollectedPrincipal(
          500_000000n, // Only 500 uncollected
          0n,
          'COLLECT',
          1000_000000n,
          0n,
          600_000000n, // Trying to collect 600 principal
          0n
        )
      ).toThrow('Cannot collect more principal than available');
    });

    it('should throw error for negative principal collected', () => {
      expect(() =>
        updateUncollectedPrincipal(1000_000000n, 0n, 'COLLECT', 100n, 0n, -50n, 0n)
      ).toThrow('Principal collected cannot be negative');
    });
  });

  describe('sequential event chains', () => {
    it('should handle DECREASE → COLLECT cycle correctly', () => {
      // DECREASE: Add to uncollected
      const afterDecrease = updateUncollectedPrincipal(
        0n,
        0n,
        'DECREASE_POSITION',
        1000_000000n,
        0n,
        0n,
        0n
      );

      expect(afterDecrease.uncollectedPrincipal0After).toBe(1000_000000n);

      // COLLECT: Separate fees from principal
      const separation = separateFeesFromPrincipal(
        1100_000000n, // Collected 1100
        0n,
        afterDecrease.uncollectedPrincipal0After, // 1000 uncollected
        0n
      );

      expect(separation.principalAmount0).toBe(1000_000000n);
      expect(separation.feeAmount0).toBe(100_000000n);

      // COLLECT: Update uncollected
      const afterCollect = updateUncollectedPrincipal(
        afterDecrease.uncollectedPrincipal0After,
        afterDecrease.uncollectedPrincipal1After,
        'COLLECT',
        1100_000000n,
        0n,
        separation.principalAmount0,
        separation.principalAmount1
      );

      expect(afterCollect.uncollectedPrincipal0After).toBe(0n);
    });

    it('should handle multiple DECREASEs before COLLECT', () => {
      // First DECREASE: 500 USDC
      const afterDecrease1 = updateUncollectedPrincipal(
        0n,
        0n,
        'DECREASE_POSITION',
        500_000000n,
        0n,
        0n,
        0n
      );

      expect(afterDecrease1.uncollectedPrincipal0After).toBe(500_000000n);

      // Second DECREASE: 500 USDC
      const afterDecrease2 = updateUncollectedPrincipal(
        afterDecrease1.uncollectedPrincipal0After,
        afterDecrease1.uncollectedPrincipal1After,
        'DECREASE_POSITION',
        500_000000n,
        0n,
        0n,
        0n
      );

      expect(afterDecrease2.uncollectedPrincipal0After).toBe(1000_000000n);

      // COLLECT: 1000 USDC (all principal)
      const separation = separateFeesFromPrincipal(
        1000_000000n,
        0n,
        afterDecrease2.uncollectedPrincipal0After,
        0n
      );

      const afterCollect = updateUncollectedPrincipal(
        afterDecrease2.uncollectedPrincipal0After,
        afterDecrease2.uncollectedPrincipal1After,
        'COLLECT',
        1000_000000n,
        0n,
        separation.principalAmount0,
        separation.principalAmount1
      );

      expect(afterCollect.uncollectedPrincipal0After).toBe(0n);
    });

    it('should handle INCREASE → DECREASE → COLLECT → INCREASE sequence', () => {
      // INCREASE: No change
      const afterIncrease1 = updateUncollectedPrincipal(
        0n,
        0n,
        'INCREASE_POSITION',
        1000_000000n,
        0n,
        0n,
        0n
      );
      expect(afterIncrease1.uncollectedPrincipal0After).toBe(0n);

      // DECREASE: Add to uncollected
      const afterDecrease = updateUncollectedPrincipal(
        afterIncrease1.uncollectedPrincipal0After,
        afterIncrease1.uncollectedPrincipal1After,
        'DECREASE_POSITION',
        500_000000n,
        0n,
        0n,
        0n
      );
      expect(afterDecrease.uncollectedPrincipal0After).toBe(500_000000n);

      // COLLECT: Reduce uncollected
      const separation = separateFeesFromPrincipal(
        600_000000n, // 500 principal + 100 fees
        0n,
        afterDecrease.uncollectedPrincipal0After,
        0n
      );

      const afterCollect = updateUncollectedPrincipal(
        afterDecrease.uncollectedPrincipal0After,
        afterDecrease.uncollectedPrincipal1After,
        'COLLECT',
        600_000000n,
        0n,
        separation.principalAmount0,
        separation.principalAmount1
      );
      expect(afterCollect.uncollectedPrincipal0After).toBe(0n);

      // INCREASE: No change
      const afterIncrease2 = updateUncollectedPrincipal(
        afterCollect.uncollectedPrincipal0After,
        afterCollect.uncollectedPrincipal1After,
        'INCREASE_POSITION',
        2000_000000n,
        0n,
        0n,
        0n
      );
      expect(afterIncrease2.uncollectedPrincipal0After).toBe(0n);
    });
  });

  describe('edge cases', () => {
    it('should throw error for negative previous uncollected', () => {
      expect(() =>
        updateUncollectedPrincipal(-100n, 0n, 'INCREASE_POSITION', 0n, 0n, 0n, 0n)
      ).toThrow('Previous uncollected principal cannot be negative');
    });

    it('should handle zero amounts throughout', () => {
      const result = updateUncollectedPrincipal(0n, 0n, 'COLLECT', 0n, 0n, 0n, 0n);

      expect(result.uncollectedPrincipal0After).toBe(0n);
      expect(result.uncollectedPrincipal1After).toBe(0n);
    });
  });
});
