import { describe, it, expect } from 'vitest';
import { isValidAddress, normalizeAddress, compareAddresses } from './address.js';

describe('EVM Address Utilities', () => {
  describe('isValidAddress', () => {
    it('should accept valid Ethereum addresses', () => {
      expect(isValidAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(isValidAddress('0xABCDEF1234567890123456789012345678901234')).toBe(true);
      expect(isValidAddress('0xabcdef1234567890123456789012345678901234')).toBe(true);
    });

    it('should accept mixed case addresses', () => {
      // USDC address (mixed case checksum)
      expect(isValidAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(true);
      // WETH address (mixed case checksum)
      expect(isValidAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')).toBe(true);
    });

    it('should accept all zeros address', () => {
      expect(isValidAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should reject addresses without 0x prefix', () => {
      expect(isValidAddress('1234567890123456789012345678901234567890')).toBe(false);
      expect(isValidAddress('abcdef1234567890123456789012345678901234')).toBe(false);
    });

    it('should reject addresses that are too short', () => {
      expect(isValidAddress('0x12345678901234567890123456789012345678')).toBe(false);
      expect(isValidAddress('0x1234')).toBe(false);
      expect(isValidAddress('0x')).toBe(false);
    });

    it('should reject addresses that are too long', () => {
      expect(isValidAddress('0x123456789012345678901234567890123456789012')).toBe(false);
    });

    it('should reject addresses with non-hex characters', () => {
      expect(isValidAddress('0x123456789012345678901234567890123456GHIJ')).toBe(false);
      expect(isValidAddress('0xZZZZZZ1234567890123456789012345678901234')).toBe(false);
      expect(isValidAddress('0x1234567890123456789012345678901234567 90')).toBe(false);
    });

    it('should reject empty strings and invalid inputs', () => {
      expect(isValidAddress('')).toBe(false);
      expect(isValidAddress('0')).toBe(false);
      expect(isValidAddress('not an address')).toBe(false);
    });
  });

  describe('normalizeAddress', () => {
    it('should convert lowercase addresses to EIP-55 checksum format', () => {
      // USDC address
      const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const usdcChecksum = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      expect(normalizeAddress(usdc)).toBe(usdcChecksum);

      // WETH address
      const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
      const wethChecksum = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      expect(normalizeAddress(weth)).toBe(wethChecksum);
    });

    it('should preserve addresses already in checksum format', () => {
      const usdcChecksum = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      expect(normalizeAddress(usdcChecksum)).toBe(usdcChecksum);

      const wethChecksum = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      expect(normalizeAddress(wethChecksum)).toBe(wethChecksum);
    });

    it('should handle all uppercase addresses', () => {
      const uppercase = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
      const result = normalizeAddress(uppercase);
      // Should return checksummed version
      expect(result).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result.length).toBe(42);
    });

    it('should handle zero address', () => {
      const zeroAddress = '0x0000000000000000000000000000000000000000';
      expect(normalizeAddress(zeroAddress)).toBe(zeroAddress);
    });

    it('should throw error for invalid address format', () => {
      expect(() => normalizeAddress('invalid')).toThrow('Invalid Ethereum address');
      expect(() => normalizeAddress('0x123')).toThrow('Invalid Ethereum address');
      expect(() => normalizeAddress('1234567890123456789012345678901234567890')).toThrow('Invalid Ethereum address');
      expect(() => normalizeAddress('')).toThrow('Invalid Ethereum address');
    });

    it('should throw error for addresses with non-hex characters', () => {
      expect(() => normalizeAddress('0xGGGGGG1234567890123456789012345678901234')).toThrow('Invalid Ethereum address');
    });
  });

  describe('compareAddresses', () => {
    it('should return -1 when first address is numerically smaller', () => {
      const smaller = '0x0000000000000000000000000000000000000001';
      const larger = '0x0000000000000000000000000000000000000002';
      expect(compareAddresses(smaller, larger)).toBe(-1);
    });

    it('should return 1 when first address is numerically larger', () => {
      const smaller = '0x0000000000000000000000000000000000000001';
      const larger = '0x0000000000000000000000000000000000000002';
      expect(compareAddresses(larger, smaller)).toBe(1);
    });

    it('should return 0 when addresses are equal', () => {
      const addr = '0x1234567890123456789012345678901234567890';
      expect(compareAddresses(addr, addr)).toBe(0);
    });

    it('should normalize before comparing (case-insensitive comparison)', () => {
      const lowercase = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const checksum = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const uppercase = '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';

      expect(compareAddresses(lowercase, checksum)).toBe(0);
      expect(compareAddresses(checksum, uppercase)).toBe(0);
      expect(compareAddresses(lowercase, uppercase)).toBe(0);
    });

    it('should provide deterministic ordering', () => {
      const addr1 = '0x1111111111111111111111111111111111111111';
      const addr2 = '0x2222222222222222222222222222222222222222';
      const addr3 = '0x3333333333333333333333333333333333333333';

      // Verify transitivity: if a < b and b < c, then a < c
      expect(compareAddresses(addr1, addr2)).toBe(-1);
      expect(compareAddresses(addr2, addr3)).toBe(-1);
      expect(compareAddresses(addr1, addr3)).toBe(-1);

      // Verify reverse comparisons
      expect(compareAddresses(addr2, addr1)).toBe(1);
      expect(compareAddresses(addr3, addr2)).toBe(1);
      expect(compareAddresses(addr3, addr1)).toBe(1);
    });

    it('should use BigInt comparison for numerical ordering', () => {
      // Test with addresses that differ in later bytes
      const addrA = '0x0000000000000000000000000000000000000100';
      const addrB = '0x0000000000000000000000000000000000000200';

      expect(compareAddresses(addrA, addrB)).toBe(-1);
      expect(compareAddresses(addrB, addrA)).toBe(1);
    });

    it('should throw error for invalid first address', () => {
      const validAddr = '0x1234567890123456789012345678901234567890';
      expect(() => compareAddresses('invalid', validAddr)).toThrow('Invalid Ethereum address');
      expect(() => compareAddresses('0x123', validAddr)).toThrow('Invalid Ethereum address');
    });

    it('should throw error for invalid second address', () => {
      const validAddr = '0x1234567890123456789012345678901234567890';
      expect(() => compareAddresses(validAddr, 'invalid')).toThrow('Invalid Ethereum address');
      expect(() => compareAddresses(validAddr, '0x123')).toThrow('Invalid Ethereum address');
    });

    it('should throw error when both addresses are invalid', () => {
      expect(() => compareAddresses('invalid1', 'invalid2')).toThrow('Invalid Ethereum address');
    });
  });

  describe('real-world token addresses', () => {
    it('should correctly handle popular token addresses', () => {
      // USDC
      const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      expect(isValidAddress(usdc)).toBe(true);
      expect(normalizeAddress(usdc)).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

      // WETH
      const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
      expect(isValidAddress(weth)).toBe(true);
      expect(normalizeAddress(weth)).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');

      // DAI
      const dai = '0x6b175474e89094c44da98b954eedeac495271d0f';
      expect(isValidAddress(dai)).toBe(true);
      const daiNormalized = normalizeAddress(dai);
      expect(daiNormalized).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should correctly order popular token addresses', () => {
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const dai = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

      // DAI has numerically smaller address than USDC
      expect(compareAddresses(dai, usdc)).toBe(-1);
      expect(compareAddresses(usdc, dai)).toBe(1);
    });
  });
});
