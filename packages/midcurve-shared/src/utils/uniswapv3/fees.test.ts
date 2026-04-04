import { describe, it, expect } from 'vitest';
import {
  safeDiff,
  computeFeeGrowthInside,
  calculateIncrementalFees,
  calculateVaultClaimableFees,
} from './fees.js';

describe('Uniswap V3 Fee Calculation Utilities', () => {
  describe('safeDiff', () => {
    it('should calculate normal difference when a > b', () => {
      const a = 1000n;
      const b = 300n;
      expect(safeDiff(a, b)).toBe(700n);
    });

    it('should calculate difference when a = b', () => {
      const a = 500n;
      const b = 500n;
      expect(safeDiff(a, b)).toBe(0n);
    });

    it('should handle uint256 overflow when b > a', () => {
      // Simulates: feeGrowthInsideLast > feeGrowthGlobal
      // Real-world example from PAXG/USDC position (NFT #1124296)
      const feeGrowthGlobal0 = 28043368056844375958451693623376279605226n;
      const feeGrowthInside0LastX128 =
        115792089237316195423570985008687907853027164261552451353508348547270706820381n;

      // In Solidity uint256: a - b wraps around at 2^256
      const diff = safeDiff(feeGrowthGlobal0, feeGrowthInside0LastX128);

      // Expected: (a - b + 2^256) % 2^256
      const expected =
        (feeGrowthGlobal0 -
          feeGrowthInside0LastX128 +
          (1n << 256n)) %
        (1n << 256n);

      expect(diff).toBe(expected);
      expect(diff).toBe(28286188460932488644400929084018702424781n);
    });

    it('should handle edge case: b = MAX_UINT256, a = 0', () => {
      const MAX_UINT256 = (1n << 256n) - 1n;
      const a = 0n;
      const b = MAX_UINT256;

      // In uint256: 0 - MAX_UINT256 = 1
      const diff = safeDiff(a, b);
      expect(diff).toBe(1n);
    });

    it('should handle edge case: a = MAX_UINT256, b = 0', () => {
      const MAX_UINT256 = (1n << 256n) - 1n;
      const a = MAX_UINT256;
      const b = 0n;

      const diff = safeDiff(a, b);
      expect(diff).toBe(MAX_UINT256);
    });

    it('should handle overflow scenario from example in docs', () => {
      // From docstring example: feeGrowthInsideLast = 2^256 - 100, feeGrowthGlobal = 50
      const a = 50n;
      const b = (1n << 256n) - 100n;

      // Expected growth: 150
      const diff = safeDiff(a, b);
      expect(diff).toBe(150n);
    });
  });

  describe('computeFeeGrowthInside', () => {
    it('should compute fee growth inside when current tick is within range', () => {
      // Example: Position range [-193810, -192630], current tick -193415
      const tickCurrent = -193415;
      const tickLower = -193810;
      const tickUpper = -192630;

      const feeGrowthGlobal0 = 28043368056844375958451693623376279605226n;
      const feeGrowthGlobal1 = 102042783659263334063278059404087n;

      // Mock tick fee growth outside values (would come from on-chain ticks)
      const feeGrowthOutsideLower0 = 1000n;
      const feeGrowthOutsideLower1 = 2000n;
      const feeGrowthOutsideUpper0 = 3000n;
      const feeGrowthOutsideUpper1 = 4000n;

      const result = computeFeeGrowthInside(
        tickCurrent,
        tickLower,
        tickUpper,
        feeGrowthGlobal0,
        feeGrowthGlobal1,
        feeGrowthOutsideLower0,
        feeGrowthOutsideLower1,
        feeGrowthOutsideUpper0,
        feeGrowthOutsideUpper1
      );

      // When current tick is in range:
      // inside = global - feeGrowthOutsideLower - feeGrowthOutsideUpper
      expect(result.inside0).toBeDefined();
      expect(result.inside1).toBeDefined();
    });

    it('should compute fee growth inside when current tick is below range', () => {
      const tickCurrent = -194000; // Below tickLower
      const tickLower = -193810;
      const tickUpper = -192630;

      const feeGrowthGlobal0 = 1000000n;
      const feeGrowthGlobal1 = 2000000n;

      const feeGrowthOutsideLower0 = 10000n;
      const feeGrowthOutsideLower1 = 20000n;
      const feeGrowthOutsideUpper0 = 5000n;
      const feeGrowthOutsideUpper1 = 8000n;

      const result = computeFeeGrowthInside(
        tickCurrent,
        tickLower,
        tickUpper,
        feeGrowthGlobal0,
        feeGrowthGlobal1,
        feeGrowthOutsideLower0,
        feeGrowthOutsideLower1,
        feeGrowthOutsideUpper0,
        feeGrowthOutsideUpper1
      );

      expect(result.inside0).toBeDefined();
      expect(result.inside1).toBeDefined();
    });

    it('should compute fee growth inside when current tick is above range', () => {
      const tickCurrent = -192000; // Above tickUpper
      const tickLower = -193810;
      const tickUpper = -192630;

      const feeGrowthGlobal0 = 1000000n;
      const feeGrowthGlobal1 = 2000000n;

      const feeGrowthOutsideLower0 = 10000n;
      const feeGrowthOutsideLower1 = 20000n;
      const feeGrowthOutsideUpper0 = 5000n;
      const feeGrowthOutsideUpper1 = 8000n;

      const result = computeFeeGrowthInside(
        tickCurrent,
        tickLower,
        tickUpper,
        feeGrowthGlobal0,
        feeGrowthGlobal1,
        feeGrowthOutsideLower0,
        feeGrowthOutsideLower1,
        feeGrowthOutsideUpper0,
        feeGrowthOutsideUpper1
      );

      expect(result.inside0).toBeDefined();
      expect(result.inside1).toBeDefined();
    });
  });

  describe('calculateIncrementalFees', () => {
    it('should calculate incremental fees for normal case', () => {
      const feeGrowthInsideCurrent = 1000000n;
      const feeGrowthInsideLast = 500000n;
      const liquidity = 1000000000n;

      const fees = calculateIncrementalFees(
        feeGrowthInsideCurrent,
        feeGrowthInsideLast,
        liquidity
      );

      // fees = (delta * liquidity) / Q128
      // delta = 500000
      // Q128 = 2^128
      const Q128 = 1n << 128n;
      const expected = (500000n * 1000000000n) / Q128;

      expect(fees).toBe(expected);
    });

    it('should calculate zero fees when no growth', () => {
      const feeGrowthInsideCurrent = 500000n;
      const feeGrowthInsideLast = 500000n;
      const liquidity = 1000000000n;

      const fees = calculateIncrementalFees(
        feeGrowthInsideCurrent,
        feeGrowthInsideLast,
        liquidity
      );

      expect(fees).toBe(0n);
    });

    it('should handle uint256 overflow in fee growth', () => {
      // Real-world example from PAXG/USDC position
      // feeGrowthInsideCurrent from computeFeeGrowthInside
      const feeGrowthInsideCurrent = 28286188460932488644400929084018702424781n;
      const feeGrowthInsideLast =
        115792089237316195423570985008687907853027164261552451353508348547270706820381n;
      const liquidity = 544221971169672n;

      const fees = calculateIncrementalFees(
        feeGrowthInsideCurrent,
        feeGrowthInsideLast,
        liquidity
      );

      // Since feeGrowthInsideLast > feeGrowthInsideCurrent (due to overflow),
      // safeDiff should handle this correctly
      // The delta should be: (current - last + 2^256) % 2^256
      const Q128 = 1n << 128n;
      const MAX_UINT256 = (1n << 256n) - 1n;
      const delta =
        (feeGrowthInsideCurrent -
          feeGrowthInsideLast +
          MAX_UINT256 +
          1n) &
        MAX_UINT256;
      const expected = (delta * liquidity) / Q128;

      expect(fees).toBe(expected);
      // Should be non-zero (actual fees were earned)
      expect(fees).toBeGreaterThan(0n);
    });

    it('should calculate zero fees when liquidity is zero', () => {
      const feeGrowthInsideCurrent = 1000000n;
      const feeGrowthInsideLast = 500000n;
      const liquidity = 0n;

      const fees = calculateIncrementalFees(
        feeGrowthInsideCurrent,
        feeGrowthInsideLast,
        liquidity
      );

      expect(fees).toBe(0n);
    });
  });

  describe('calculateVaultClaimableFees', () => {
    const FEE_PRECISION = 10n ** 18n;

    const zeroInput = {
      feePerShare0: 0n,
      feePerShare1: 0n,
      feeDebt0: 0n,
      feeDebt1: 0n,
      userShares: 0n,
      tokensOwed0: 0n,
      tokensOwed1: 0n,
      totalSupply: 0n,
      unsnapshottedFees0: 0n,
      unsnapshottedFees1: 0n,
    };

    it('returns zero for all-zero input', () => {
      const result = calculateVaultClaimableFees(zeroInput);
      expect(result.fee0).toBe(0n);
      expect(result.fee1).toBe(0n);
    });

    it('returns zero when userShares is zero', () => {
      const result = calculateVaultClaimableFees({
        ...zeroInput,
        tokensOwed0: 500n,
        totalSupply: 1000n,
        unsnapshottedFees0: 200n,
      });
      expect(result.fee0).toBe(0n);
      expect(result.fee1).toBe(0n);
    });

    it('computes accumulator delta correctly', () => {
      const result = calculateVaultClaimableFees({
        ...zeroInput,
        feePerShare0: 10n * FEE_PRECISION,
        feePerShare1: 20n * FEE_PRECISION,
        userShares: 100n,
        totalSupply: 1000n,
      });
      // (10 * 1e18 - 0) * 100 / 1e18 = 1000
      expect(result.fee0).toBe(1000n);
      expect(result.fee1).toBe(2000n);
    });

    it('computes tokensOwed (component 3) correctly', () => {
      const result = calculateVaultClaimableFees({
        ...zeroInput,
        tokensOwed0: 10_000n,
        tokensOwed1: 20_000n,
        userShares: 250n,
        totalSupply: 1000n,
      });
      // 10000 * 250 / 1000 = 2500
      expect(result.fee0).toBe(2500n);
      expect(result.fee1).toBe(5000n);
    });

    it('computes unsnapshotted fees (component 4) correctly', () => {
      const result = calculateVaultClaimableFees({
        ...zeroInput,
        unsnapshottedFees0: 8000n,
        unsnapshottedFees1: 16_000n,
        userShares: 500n,
        totalSupply: 1000n,
      });
      // 8000 * 500 / 1000 = 4000
      expect(result.fee0).toBe(4000n);
      expect(result.fee1).toBe(8000n);
    });

    it('sums all components correctly', () => {
      const result = calculateVaultClaimableFees({
        feePerShare0: 5n * FEE_PRECISION,
        feePerShare1: 10n * FEE_PRECISION,
        feeDebt0: 0n,
        feeDebt1: 0n,
        userShares: 500n,
        tokensOwed0: 1000n,
        tokensOwed1: 2000n,
        totalSupply: 1000n,
        unsnapshottedFees0: 600n,
        unsnapshottedFees1: 1200n,
      });
      // Accumulator: (5*1e18 * 500) / 1e18 = 2500, (10*1e18 * 500) / 1e18 = 5000
      // TokensOwed: 1000 * 500 / 1000 = 500, 2000 * 500 / 1000 = 1000
      // Unsnapshotted: 600 * 500 / 1000 = 300, 1200 * 500 / 1000 = 600
      // Total: 3300, 6600
      expect(result.fee0).toBe(3300n);
      expect(result.fee1).toBe(6600n);
    });

    it('handles totalSupply == 0 (components 3+4 contribute zero)', () => {
      const result = calculateVaultClaimableFees({
        ...zeroInput,
        feePerShare0: 2n * FEE_PRECISION,
        feePerShare1: 4n * FEE_PRECISION,
        userShares: 50n,
        tokensOwed0: 9999n,
        tokensOwed1: 9999n,
        totalSupply: 0n,
        unsnapshottedFees0: 9999n,
        unsnapshottedFees1: 9999n,
      });
      // Only accumulator contributes; tokensOwed + unsnapshotted skipped (totalSupply == 0)
      expect(result.fee0).toBe(100n); // (2*1e18 * 50) / 1e18
      expect(result.fee1).toBe(200n);
    });
  });
});
