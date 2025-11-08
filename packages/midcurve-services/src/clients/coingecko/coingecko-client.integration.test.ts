/**
 * Integration tests for CoinGeckoClient
 * Tests real API interactions, caching behavior, and error handling
 *
 * These tests verify:
 * - Real CoinGecko API connectivity and responses
 * - Token discovery across multiple chains
 * - Market data enrichment with actual data
 * - Cache behavior with real timing
 * - Multi-chain support (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)
 * - Error handling and rate limiting resilience
 *
 * NOTE: These tests make real API calls and may be subject to rate limiting.
 * CoinGecko's free API has strict rate limits (~30 calls/minute).
 * If tests fail with 429 errors, wait a few minutes and retry.
 *
 * RATE LIMITING STRATEGY:
 * - Tests are designed to minimize API calls through caching
 * - Tests can run sequentially to reduce rate limit pressure
 * - Run with: npm run test:integration:run -- --reporter=verbose --bail
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CoinGeckoClient,
  TokenNotFoundInCoinGeckoError,
  CoinGeckoApiError,
  type CoinGeckoToken,
  type CoinGeckoDetailedCoin,
  type EnrichmentData,
} from './coingecko-client.js';

// Known stable tokens for testing (real addresses and data)
// NOTE: expectedName values are based on actual CoinGecko API responses
const TEST_TOKENS = {
  USDC_ETHEREUM: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    expectedCoinId: 'usd-coin',
    expectedSymbol: 'USDC',
    expectedName: 'USDC', // CoinGecko API returns "USDC" not "USD Coin"
  },
  USDC_ARBITRUM: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
    expectedCoinId: 'usd-coin',
    expectedSymbol: 'USDC',
    expectedName: 'USDC', // CoinGecko API returns "USDC" not "USD Coin"
  },
  WETH_ETHEREUM: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chainId: 1,
    expectedCoinId: 'weth',
    expectedSymbol: 'WETH',
    expectedName: 'WETH',
  },
  DAI_ETHEREUM: {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 1,
    expectedCoinId: 'dai',
    expectedSymbol: 'DAI',
    expectedName: 'Dai',
  },
} as const;

// Helper to measure execution time
async function measureExecutionTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

// Helper to check if error is rate limit
function isRateLimitError(error: unknown): boolean {
  return (
    error instanceof CoinGeckoApiError &&
    error.statusCode === 429
  );
}

describe('CoinGeckoClient - Integration Tests', () => {
  let client: CoinGeckoClient;

  beforeAll(() => {
    // Get singleton instance - cache is warmed up in global-setup.ts
    // Cache is shared across all tests via PostgreSQL
    client = CoinGeckoClient.getInstance();
  });

  // ==========================================================================
  // API Health and Basic Connectivity
  // ==========================================================================

  describe('API Health and Connectivity', () => {
    it('should successfully connect to CoinGecko API', { timeout: 30000 }, async () => {
      try {
        const tokens = await client.getAllTokens();

        // Verify we got a response
        expect(tokens).toBeDefined();
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited by CoinGecko API. This is expected for free tier.');
          // Don't fail the test on rate limit - it's environmental
          expect(error).toBeInstanceOf(CoinGeckoApiError);
        } else {
          throw error;
        }
      }
    });

    it('should return tokens with correct structure', { timeout: 30000 }, async () => {
      try {
        const tokens = await client.getAllTokens();

        // Verify structure of first token
        const token = tokens[0];
        expect(token).toHaveProperty('id');
        expect(token).toHaveProperty('symbol');
        expect(token).toHaveProperty('name');
        expect(token).toHaveProperty('platforms');
        expect(typeof token.id).toBe('string');
        expect(typeof token.symbol).toBe('string');
        expect(typeof token.name).toBe('string');
        expect(typeof token.platforms).toBe('object');
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should only return tokens on supported chains', { timeout: 30000 }, async () => {
      try {
        const tokens = await client.getAllTokens();

        // Verify all tokens have at least one supported platform
        const supportedPlatforms = [
          'ethereum',
          'arbitrum-one',
          'base',
          'binance-smart-chain',
          'polygon-pos',
          'optimistic-ethereum',
        ];

        tokens.forEach((token) => {
          const hasSupportedPlatform = supportedPlatforms.some(
            (platform) =>
              token.platforms[platform] && token.platforms[platform].trim() !== ''
          );
          expect(hasSupportedPlatform).toBe(true);
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });
  });

  // ==========================================================================
  // getAllTokens() - Real API Integration
  // ==========================================================================

  describe('getAllTokens()', () => {
    it('should fetch and cache tokens from real API', { timeout: 30000 }, async () => {
      try {
        // First call - may hit cache or fetch from API (depending on previous test runs)
        const tokens = await client.getAllTokens();
        expect(tokens.length).toBeGreaterThan(1000); // CoinGecko has thousands of tokens

        // Verify cache is now populated (this may already be true from previous runs)
        const hasCached = await client.hasCachedData();
        expect(hasCached).toBe(true);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should use cached data on subsequent calls (performance)', { timeout: 30000 }, async () => {
      try {
        // Make two calls - second should be much faster due to cache
        const { duration: firstCallDuration } = await measureExecutionTime(() =>
          client.getAllTokens()
        );

        const { duration: secondCallDuration } = await measureExecutionTime(() =>
          client.getAllTokens()
        );

        // If both calls hit cache (typical), both will be fast
        // If first was API call and second was cache, second should be much faster
        // Either way, second call should be fast (< 50ms for database cache lookup)
        expect(secondCallDuration).toBeLessThan(50);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should find specific known tokens in the list', { timeout: 30000 }, async () => {
      try {
        const tokens = await client.getAllTokens();

        // Find USDC
        const usdc = tokens.find((t) => t.id === 'usd-coin');
        expect(usdc).toBeDefined();
        expect(usdc?.symbol.toLowerCase()).toBe('usdc');
        // CoinGecko returns lowercase addresses, so compare case-insensitively
        expect(usdc?.platforms.ethereum.toLowerCase()).toBe(
          TEST_TOKENS.USDC_ETHEREUM.address.toLowerCase()
        );

        // Find WETH
        const weth = tokens.find((t) => t.id === 'weth');
        expect(weth).toBeDefined();
        expect(weth?.symbol.toLowerCase()).toBe('weth');
        expect(weth?.platforms.ethereum.toLowerCase()).toBe(
          TEST_TOKENS.WETH_ETHEREUM.address.toLowerCase()
        );
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });
  });

  // ==========================================================================
  // findCoinByAddress() - Real Token Discovery
  // ==========================================================================

  describe('findCoinByAddress()', () => {
    it('should find USDC on Ethereum', { timeout: 30000 }, async () => {
      try {
        const coinId = await client.findCoinByAddress(
          TEST_TOKENS.USDC_ETHEREUM.chainId,
          TEST_TOKENS.USDC_ETHEREUM.address
        );

        expect(coinId).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedCoinId);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should find WETH on Ethereum', { timeout: 30000 }, async () => {
      try {
        const coinId = await client.findCoinByAddress(
          TEST_TOKENS.WETH_ETHEREUM.chainId,
          TEST_TOKENS.WETH_ETHEREUM.address
        );

        expect(coinId).toBe(TEST_TOKENS.WETH_ETHEREUM.expectedCoinId);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should be case-insensitive for addresses', { timeout: 30000 }, async () => {
      try {
        // Test with lowercase
        const coinIdLower = await client.findCoinByAddress(
          1,
          TEST_TOKENS.USDC_ETHEREUM.address.toLowerCase()
        );
        expect(coinIdLower).toBe('usd-coin');

        // Test with uppercase
        const coinIdUpper = await client.findCoinByAddress(
          1,
          TEST_TOKENS.USDC_ETHEREUM.address.toUpperCase()
        );
        expect(coinIdUpper).toBe('usd-coin');
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should return null for non-existent address', { timeout: 30000 }, async () => {
      try {
        const coinId = await client.findCoinByAddress(
          1,
          '0x0000000000000000000000000000000000000001' // Non-existent
        );

        expect(coinId).toBeNull();
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should return null for unsupported chain', { timeout: 30000 }, async () => {
      try {
        const coinId = await client.findCoinByAddress(
          999999, // Unsupported chain
          TEST_TOKENS.USDC_ETHEREUM.address
        );

        expect(coinId).toBeNull();
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });
  });

  // ==========================================================================
  // getCoinDetails() - Market Data Validation
  // ==========================================================================

  describe('getCoinDetails()', () => {
    it('should fetch real coin details for USDC', { timeout: 30000 }, async () => {
      try {
        const details = await client.getCoinDetails('usd-coin');

        // Verify all required fields
        expect(details.id).toBe('usd-coin');
        expect(details.symbol).toBe('usdc');
        expect(details.name).toBe('USDC');

        // Verify image URLs
        expect(details.image.thumb).toContain('http');
        expect(details.image.small).toContain('http');
        expect(details.image.large).toContain('http');

        // Verify market data
        expect(details.market_data.market_cap.usd).toBeGreaterThan(0);
        expect(typeof details.market_data.market_cap.usd).toBe('number');

        // Verify platforms
        expect(details.platforms).toHaveProperty('ethereum');
        // CoinGecko returns lowercase addresses, so compare case-insensitively
        expect(details.platforms.ethereum.toLowerCase()).toBe(
          TEST_TOKENS.USDC_ETHEREUM.address.toLowerCase()
        );
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should throw CoinGeckoApiError for invalid coin ID', { timeout: 30000 }, async () => {
      try {
        await client.getCoinDetails('this-coin-definitely-does-not-exist-123456');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(CoinGeckoApiError);
      }
    });
  });

  // ==========================================================================
  // getErc20EnrichmentData() - End-to-End Enrichment
  // ==========================================================================

  describe('getErc20EnrichmentData()', () => {
    it('should enrich USDC on Ethereum with real data', { timeout: 30000 }, async () => {
      try {
        const data = await client.getErc20EnrichmentData(
          TEST_TOKENS.USDC_ETHEREUM.chainId,
          TEST_TOKENS.USDC_ETHEREUM.address
        );

        // Verify enrichment data
        expect(data.coingeckoId).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedCoinId);
        expect(data.symbol).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedSymbol);
        expect(data.name).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedName);
        expect(data.logoUrl).toContain('http');
        expect(data.marketCap).toBeGreaterThan(0);

        // Verify market cap is reasonable (USDC typically > $10B)
        expect(data.marketCap).toBeGreaterThan(10_000_000_000);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should normalize symbol to uppercase', { timeout: 30000 }, async () => {
      try {
        const data = await client.getErc20EnrichmentData(
          TEST_TOKENS.USDC_ETHEREUM.chainId,
          TEST_TOKENS.USDC_ETHEREUM.address
        );

        // CoinGecko returns lowercase, but should be normalized
        expect(data.symbol).toBe('USDC');
        expect(data.symbol).toEqual(data.symbol.toUpperCase());
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should throw TokenNotFoundInCoinGeckoError for non-existent token', { timeout: 30000 }, async () => {
      try {
        await client.getErc20EnrichmentData(
          1,
          '0x0000000000000000000000000000000000000001'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Could be rate limited OR token not found
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        expect(error).toBeInstanceOf(TokenNotFoundInCoinGeckoError);
      }
    });
  });

  // ==========================================================================
  // Cache Management and Performance
  // ==========================================================================

  describe('Cache Management', () => {
    it.skip('should cache data and improve performance', { timeout: 60000 }, async () => {
      try {
        // Clear cache for this specific test
        await client.clearCache();

        // First call - will fetch from API (with rate limiting, may take 2-5 seconds)
        const { duration: uncachedDuration } = await measureExecutionTime(() =>
          client.getAllTokens()
        );

        // Second call - should hit cache
        const { duration: cachedDuration } = await measureExecutionTime(() =>
          client.getAllTokens()
        );

        // Cached should be significantly faster (database vs API call)
        expect(cachedDuration).toBeLessThan(uncachedDuration / 5);
        expect(cachedDuration).toBeLessThan(100); // Database cache should be < 100ms
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it.skip('should report cached data status correctly', { timeout: 60000 }, async () => {
      try {
        // Clear cache
        await client.clearCache();
        expect(await client.hasCachedData()).toBe(false);

        // Populate cache
        await client.getAllTokens();
        expect(await client.hasCachedData()).toBe(true);

        // Clear again
        await client.clearCache();
        expect(await client.hasCachedData()).toBe(false);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should maintain cache across multiple method calls', { timeout: 30000 }, async () => {
      try {
        // Ensure cache is populated
        await client.getAllTokens();
        const hasCacheAfterFirst = await client.hasCachedData();
        expect(hasCacheAfterFirst).toBe(true);

        // Subsequent calls should use same cache
        await client.findCoinByAddress(1, TEST_TOKENS.USDC_ETHEREUM.address);
        await client.findCoinByAddress(1, TEST_TOKENS.WETH_ETHEREUM.address);

        // Cache should still be present
        expect(await client.hasCachedData()).toBe(true);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });
  });

  // ==========================================================================
  // Multi-Chain Support
  // ==========================================================================

  describe('Multi-Chain Support', () => {
    it('should return all 6 supported chain IDs', () => {
      const chainIds = client.getSupportedChainIds();

      expect(chainIds).toHaveLength(6);
      expect(chainIds).toContain(1); // Ethereum
      expect(chainIds).toContain(42161); // Arbitrum
      expect(chainIds).toContain(8453); // Base
      expect(chainIds).toContain(56); // BSC
      expect(chainIds).toContain(137); // Polygon
      expect(chainIds).toContain(10); // Optimism
    });

    it('should correctly identify supported chains', () => {
      // Supported chains
      expect(client.isChainSupported(1)).toBe(true);
      expect(client.isChainSupported(42161)).toBe(true);
      expect(client.isChainSupported(8453)).toBe(true);
      expect(client.isChainSupported(56)).toBe(true);
      expect(client.isChainSupported(137)).toBe(true);
      expect(client.isChainSupported(10)).toBe(true);

      // Unsupported chains
      expect(client.isChainSupported(999999)).toBe(false);
      expect(client.isChainSupported(0)).toBe(false);
    });

    it('should find same token (USDC) on different chains', { timeout: 30000 }, async () => {
      try {
        // Find USDC on Ethereum
        const coinIdEth = await client.findCoinByAddress(
          TEST_TOKENS.USDC_ETHEREUM.chainId,
          TEST_TOKENS.USDC_ETHEREUM.address
        );

        // Find USDC on Arbitrum
        const coinIdArb = await client.findCoinByAddress(
          TEST_TOKENS.USDC_ARBITRUM.chainId,
          TEST_TOKENS.USDC_ARBITRUM.address
        );

        // Should be the same coin ID
        expect(coinIdEth).toBe('usd-coin');
        expect(coinIdArb).toBe('usd-coin');
        expect(coinIdEth).toBe(coinIdArb);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });
  });

  // ==========================================================================
  // Error Handling and Edge Cases
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle network errors gracefully', { timeout: 30000 }, async () => {
      // This test verifies error handling but doesn't force a failure
      // If network is down, it will throw CoinGeckoApiError
      try {
        await client.getAllTokens();
      } catch (error) {
        expect(error).toBeInstanceOf(CoinGeckoApiError);
        expect((error as Error).message).toContain('CoinGecko');
      }
    });

    it('should provide meaningful error for invalid coin ID', { timeout: 60000 }, async () => {
      try {
        await client.getCoinDetails('invalid-coin-id-that-does-not-exist');
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Could get rate limited (429) which triggers retries, or get 404 immediately
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited during error test - this is acceptable');
          return;
        }
        expect(error).toBeInstanceOf(CoinGeckoApiError);
        expect((error as Error).message).toContain('CoinGecko API error');
      }
    });

    it('should provide meaningful error for token not found', { timeout: 30000 }, async () => {
      try {
        await client.getErc20EnrichmentData(
          1,
          '0x1111111111111111111111111111111111111111'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Could be rate limited OR token not found
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - this is acceptable');
          return;
        }
        expect(error).toBeInstanceOf(TokenNotFoundInCoinGeckoError);
        expect((error as Error).message).toContain('Token not found');
        expect((error as Error).message).toContain('chain 1');
        expect((error as Error).message).toContain(
          '0x1111111111111111111111111111111111111111'
        );
      }
    });
  });

  // ==========================================================================
  // Singleton Pattern
  // ==========================================================================

  describe('Singleton Pattern', () => {
    it('should return same instance across getInstance() calls', () => {
      const instance1 = CoinGeckoClient.getInstance();
      const instance2 = CoinGeckoClient.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = CoinGeckoClient.getInstance();

      CoinGeckoClient.resetInstance();

      const instance2 = CoinGeckoClient.getInstance();

      expect(instance1).not.toBe(instance2);
    });

    it('should share cache across getInstance() calls via PostgreSQL', { timeout: 30000 }, async () => {
      try {
        const instance1 = CoinGeckoClient.getInstance();

        // Populate cache
        await instance1.getAllTokens();
        expect(await instance1.hasCachedData()).toBe(true);

        // Get same instance again - cache is shared via PostgreSQL
        const instance2 = CoinGeckoClient.getInstance();
        expect(await instance2.hasCachedData()).toBe(true);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });

    it('should persist cache even after resetting instance', { timeout: 30000 }, async () => {
      try {
        const instance1 = CoinGeckoClient.getInstance();
        await instance1.getAllTokens();
        expect(await instance1.hasCachedData()).toBe(true);

        // Reset instance - but cache persists in PostgreSQL
        CoinGeckoClient.resetInstance();

        const instance2 = CoinGeckoClient.getInstance();
        // Cache still exists in database
        expect(await instance2.hasCachedData()).toBe(true);
      } catch (error) {
        if (isRateLimitError(error)) {
          console.warn('⚠️  Rate limited - skipping test');
          return;
        }
        throw error;
      }
    });
  });
});
