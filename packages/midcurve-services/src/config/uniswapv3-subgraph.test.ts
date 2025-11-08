/**
 * Uniswap V3 Subgraph Configuration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getUniswapV3SubgraphEndpoint,
  isUniswapV3SubgraphSupported,
  getSupportedUniswapV3SubgraphChains,
} from './uniswapv3-subgraph.js';

describe('Uniswap V3 Subgraph Configuration', () => {
  const originalApiKey = process.env.THE_GRAPH_API_KEY;

  beforeEach(() => {
    // Set a test API key
    process.env.THE_GRAPH_API_KEY = 'test_api_key_12345';
  });

  afterEach(() => {
    // Restore original API key
    process.env.THE_GRAPH_API_KEY = originalApiKey;
  });

  describe('getUniswapV3SubgraphEndpoint()', () => {
    it('should replace [api-key] placeholder with actual API key', () => {
      const endpoint = getUniswapV3SubgraphEndpoint(1); // Ethereum

      // Should contain the test API key
      expect(endpoint).toContain('test_api_key_12345');

      // Should NOT contain the placeholder
      expect(endpoint).not.toContain('[api-key]');

      // Should be a valid gateway URL
      expect(endpoint).toContain('gateway.thegraph.com/api/test_api_key_12345');
    });

    it('should return different endpoints for different chains', () => {
      const ethEndpoint = getUniswapV3SubgraphEndpoint(1); // Ethereum
      const arbEndpoint = getUniswapV3SubgraphEndpoint(42161); // Arbitrum

      // Both should have the API key
      expect(ethEndpoint).toContain('test_api_key_12345');
      expect(arbEndpoint).toContain('test_api_key_12345');

      // But should have different subgraph IDs
      expect(ethEndpoint).not.toBe(arbEndpoint);
    });

    it('should throw error for unsupported chain', () => {
      expect(() => getUniswapV3SubgraphEndpoint(999)).toThrow(
        'Uniswap V3 subgraph not available for chain 999'
      );
    });

    it('should use placeholder in test mode if API key not configured', () => {
      // Remove API key
      delete process.env.THE_GRAPH_API_KEY;

      // Should not throw in test mode (NODE_ENV=test)
      const endpoint = getUniswapV3SubgraphEndpoint(1);

      // Should use the test placeholder
      expect(endpoint).toContain('test-api-key-placeholder');
    });

    it('should throw error if API key not configured in non-test mode', () => {
      // Remove API key
      delete process.env.THE_GRAPH_API_KEY;

      // Temporarily set to production mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      expect(() => getUniswapV3SubgraphEndpoint(1)).toThrow(
        'The Graph API key not configured'
      );

      expect(() => getUniswapV3SubgraphEndpoint(1)).toThrow(
        'THE_GRAPH_API_KEY'
      );

      // Restore
      process.env.NODE_ENV = originalEnv;
    });

    it('should include helpful instructions in error message for production', () => {
      delete process.env.THE_GRAPH_API_KEY;

      // Set to production mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        getUniswapV3SubgraphEndpoint(1);
        expect.fail('Should have thrown error');
      } catch (error) {
        const message = (error as Error).message;

        // Should mention where to get the key
        expect(message).toContain('thegraph.com/studio/apikeys');

        // Should show example
        expect(message).toContain('THE_GRAPH_API_KEY=');
      } finally {
        // Restore
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('isUniswapV3SubgraphSupported()', () => {
    it('should return true for Ethereum', () => {
      expect(isUniswapV3SubgraphSupported(1)).toBe(true);
    });

    it('should return true for Arbitrum', () => {
      expect(isUniswapV3SubgraphSupported(42161)).toBe(true);
    });

    it('should return true for Base', () => {
      expect(isUniswapV3SubgraphSupported(8453)).toBe(true);
    });

    it('should return true for Optimism', () => {
      expect(isUniswapV3SubgraphSupported(10)).toBe(true);
    });

    it('should return true for Polygon', () => {
      expect(isUniswapV3SubgraphSupported(137)).toBe(true);
    });

    it('should return false for unsupported chain', () => {
      expect(isUniswapV3SubgraphSupported(999)).toBe(false);
    });
  });

  describe('getSupportedUniswapV3SubgraphChains()', () => {
    it('should return array of supported chain IDs', () => {
      const chains = getSupportedUniswapV3SubgraphChains();

      expect(Array.isArray(chains)).toBe(true);
      expect(chains.length).toBeGreaterThan(0);

      // Should include major chains
      expect(chains).toContain(1); // Ethereum
      expect(chains).toContain(42161); // Arbitrum
      expect(chains).toContain(8453); // Base
      expect(chains).toContain(10); // Optimism
      expect(chains).toContain(137); // Polygon
    });

    it('should return numeric array', () => {
      const chains = getSupportedUniswapV3SubgraphChains();

      chains.forEach((chainId) => {
        expect(typeof chainId).toBe('number');
      });
    });
  });

  describe('API Key Environment Variable', () => {
    it('should work with different API key formats', () => {
      const testKeys = [
        'abc123',
        'very-long-api-key-with-dashes-12345',
        'MixedCaseKey123',
        '1234567890',
      ];

      testKeys.forEach((key) => {
        process.env.THE_GRAPH_API_KEY = key;
        const endpoint = getUniswapV3SubgraphEndpoint(1);

        expect(endpoint).toContain(key);
        expect(endpoint).not.toContain('[api-key]');
      });
    });
  });
});
