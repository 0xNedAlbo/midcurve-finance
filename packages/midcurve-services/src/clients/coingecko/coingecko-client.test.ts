/**
 * Tests for CoinGeckoClient
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { DeepMockProxy } from 'vitest-mock-extended';
import {
  CoinGeckoClient,
  TokenNotFoundInCoinGeckoError,
  CoinGeckoApiError,
  type CoinGeckoToken,
  type CoinGeckoDetailedCoin,
} from './coingecko-client.js';
import { CacheService } from '../../services/cache/index.js';
import { RequestScheduler } from '../../utils/request-scheduler/index.js';

describe('CoinGeckoClient', () => {
  let client: CoinGeckoClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let cacheServiceMock: DeepMockProxy<CacheService>;
  let requestSchedulerMock: DeepMockProxy<RequestScheduler>;

  beforeEach(() => {
    // Reset singleton before each test
    CoinGeckoClient.resetInstance();

    // Mock CacheService
    cacheServiceMock = mockDeep<CacheService>();
    // Default: cache miss (returns null)
    cacheServiceMock.get.mockResolvedValue(null);
    cacheServiceMock.set.mockResolvedValue(true);
    cacheServiceMock.delete.mockResolvedValue(true);
    cacheServiceMock.clear.mockResolvedValue(0);

    // Mock RequestScheduler to execute tasks immediately
    requestSchedulerMock = mockDeep<RequestScheduler>();
    requestSchedulerMock.schedule.mockImplementation(async (task) => {
      return await task();
    });

    // Create client with mocked cache and scheduler
    client = new CoinGeckoClient({
      cacheService: cacheServiceMock,
      requestScheduler: requestSchedulerMock,
    });

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
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
  });

  describe('getAllTokens()', () => {
    const mockTokens: CoinGeckoToken[] = [
      {
        id: 'usd-coin',
        symbol: 'usdc',
        name: 'USD Coin',
        platforms: {
          ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          'arbitrum-one': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        },
      },
      {
        id: 'wrapped-ether',
        symbol: 'weth',
        name: 'Wrapped Ether',
        platforms: {
          ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        },
      },
      {
        id: 'some-unsupported-token',
        symbol: 'unsup',
        name: 'Unsupported Token',
        platforms: {
          solana: 'SomeBase58Address',
        },
      },
    ];

    it('should fetch and cache tokens from API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      });

      const tokens = await client.getAllTokens();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
      );
      expect(tokens).toHaveLength(2); // Unsupported token filtered out
      expect(tokens[0].id).toBe('usd-coin');
      expect(tokens[1].id).toBe('wrapped-ether');
    });

    it('should return cached tokens on subsequent calls', async () => {
      const filteredTokens = mockTokens.slice(0, 2);

      // First call - cache miss, fetches from API
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      });

      const tokens1 = await client.getAllTokens();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call - cache hit, doesn't fetch
      cacheServiceMock.get.mockResolvedValueOnce(filteredTokens);

      const tokens2 = await client.getAllTokens();
      expect(fetchMock).toHaveBeenCalledTimes(1); // Not called again
      expect(tokens2).toEqual(filteredTokens);
    });

    it('should filter tokens to only supported chains', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      });

      const tokens = await client.getAllTokens();

      // Should only include tokens with addresses on supported chains
      expect(tokens).toHaveLength(2);
      expect(tokens.every((t) => t.id !== 'some-unsupported-token')).toBe(
        true
      );
    });

    it('should throw CoinGeckoApiError on API failure', async () => {
      // Use fake timers to speed up retry delays
      vi.useFakeTimers();

      // Mock persistent 429 errors (will retry 6 times before giving up)
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      const promise = client.getAllTokens();
      // Add catch handler to prevent unhandled rejection warning
      promise.catch(() => {});

      // Fast-forward through all retry delays
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(CoinGeckoApiError);
      // Verify it retried multiple times (7 = initial + 6 retries)
      expect(fetchMock).toHaveBeenCalledTimes(7);

      vi.useRealTimers();
    });

    it('should use cache when available even if API would fail', async () => {
      const filteredTokens = mockTokens.slice(0, 2);

      // Simulate cache hit (no API call needed)
      cacheServiceMock.get.mockResolvedValueOnce(filteredTokens);

      const tokens = await client.getAllTokens();
      expect(tokens).toHaveLength(2);
      expect(tokens).toEqual(filteredTokens);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should throw error if API fails and no cache exists', async () => {
      // Use fake timers to speed up retry delays
      vi.useFakeTimers();

      // Mock persistent 500 errors (will retry 6 times before giving up)
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const promise = client.getAllTokens();
      // Add catch handler to prevent unhandled rejection warning
      promise.catch(() => {});

      // Fast-forward through all retry delays
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(CoinGeckoApiError);
      // Verify it retried multiple times (7 = initial + 6 retries)
      expect(fetchMock).toHaveBeenCalledTimes(7);

      vi.useRealTimers();
    });
  });

  describe('findCoinByAddress()', () => {
    const mockTokens: CoinGeckoToken[] = [
      {
        id: 'usd-coin',
        symbol: 'usdc',
        name: 'USD Coin',
        platforms: {
          ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          'arbitrum-one': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        },
      },
    ];

    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockTokens,
      });
    });

    it('should find coin ID by address on Ethereum', async () => {
      const coinId = await client.findCoinByAddress(
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );
      expect(coinId).toBe('usd-coin');
    });

    it('should find coin ID by address on Arbitrum', async () => {
      const coinId = await client.findCoinByAddress(
        42161,
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
      );
      expect(coinId).toBe('usd-coin');
    });

    it('should be case-insensitive', async () => {
      const coinId = await client.findCoinByAddress(
        1,
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      );
      expect(coinId).toBe('usd-coin');
    });

    it('should return null for non-existent address', async () => {
      const coinId = await client.findCoinByAddress(
        1,
        '0x0000000000000000000000000000000000000000'
      );
      expect(coinId).toBeNull();
    });

    it('should return null for unsupported chain', async () => {
      const coinId = await client.findCoinByAddress(
        999999,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );
      expect(coinId).toBeNull();
    });
  });

  describe('getCoinDetails()', () => {
    const mockCoinDetails: CoinGeckoDetailedCoin = {
      id: 'usd-coin',
      symbol: 'usdc',
      name: 'USD Coin',
      image: {
        thumb: 'https://example.com/thumb.png',
        small: 'https://example.com/small.png',
        large: 'https://example.com/large.png',
      },
      market_data: {
        market_cap: {
          usd: 28000000000,
        },
      },
      platforms: {
        ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      },
    };

    it('should fetch coin details successfully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCoinDetails,
      });

      const details = await client.getCoinDetails('usd-coin');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/coins/usd-coin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false'
      );
      expect(details.id).toBe('usd-coin');
      expect(details.symbol).toBe('usdc');
      expect(details.market_data.market_cap.usd).toBe(28000000000);
      expect(details.image.small).toBe('https://example.com/small.png');
    });

    it('should throw CoinGeckoApiError on API failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(client.getCoinDetails('invalid-coin')).rejects.toThrow(
        CoinGeckoApiError
      );
    });
  });

  describe('getErc20EnrichmentData()', () => {
    const mockTokens: CoinGeckoToken[] = [
      {
        id: 'usd-coin',
        symbol: 'usdc',
        name: 'USD Coin',
        platforms: {
          ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      },
    ];

    const mockCoinDetails: CoinGeckoDetailedCoin = {
      id: 'usd-coin',
      symbol: 'usdc',
      name: 'USD Coin',
      image: {
        thumb: 'https://example.com/thumb.png',
        small: 'https://example.com/small.png',
        large: 'https://example.com/large.png',
      },
      market_data: {
        market_cap: {
          usd: 28000000000,
        },
      },
      platforms: {
        ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      },
    };

    it('should return enrichment data successfully', async () => {
      // Mock token list
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      });

      // Mock coin details
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCoinDetails,
      });

      const data = await client.getErc20EnrichmentData(
        1,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );

      expect(data.coingeckoId).toBe('usd-coin');
      expect(data.logoUrl).toBe('https://example.com/small.png');
      expect(data.marketCap).toBe(28000000000);
      expect(data.symbol).toBe('USDC');
      expect(data.name).toBe('USD Coin');
    });

    it('should throw TokenNotFoundInCoinGeckoError if token not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      });

      await expect(
        client.getErc20EnrichmentData(
          1,
          '0x0000000000000000000000000000000000000000'
        )
      ).rejects.toThrow(TokenNotFoundInCoinGeckoError);
    });

    it('should throw CoinGeckoApiError if market cap is missing', async () => {
      const detailsWithoutMarketCap = {
        ...mockCoinDetails,
        market_data: { market_cap: { usd: 0 } },
      };

      // Clear cache to ensure fresh calls
      client.clearCache();

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTokens,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => detailsWithoutMarketCap,
        } as Response);

      await expect(
        client.getErc20EnrichmentData(
          1,
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        )
      ).rejects.toThrow(CoinGeckoApiError);

      // Clear cache again for second call
      client.clearCache();

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTokens,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => detailsWithoutMarketCap,
        } as Response);

      await expect(
        client.getErc20EnrichmentData(
          1,
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        )
      ).rejects.toThrow('Market cap data not available');
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await client.getAllTokens();

      // After getAllTokens(), cache should have data
      cacheServiceMock.get.mockResolvedValueOnce([]);
      expect(await client.hasCachedData()).toBe(true);

      // After clearCache(), cache should be empty
      await client.clearCache();
      cacheServiceMock.get.mockResolvedValueOnce(null);
      expect(await client.hasCachedData()).toBe(false);
    });

    it('should report cached data status', async () => {
      // Initially no cache
      cacheServiceMock.get.mockResolvedValueOnce(null);
      expect(await client.hasCachedData()).toBe(false);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await client.getAllTokens();

      // After getAllTokens(), cache should have data
      cacheServiceMock.get.mockResolvedValueOnce([]);
      expect(await client.hasCachedData()).toBe(true);
    });
  });

  describe('chain support', () => {
    it('should return supported chain IDs', () => {
      const chainIds = client.getSupportedChainIds();
      expect(chainIds).toContain(1); // Ethereum
      expect(chainIds).toContain(42161); // Arbitrum
      expect(chainIds).toContain(8453); // Base
      expect(chainIds).toContain(56); // BSC
      expect(chainIds).toContain(137); // Polygon
      expect(chainIds).toContain(10); // Optimism
    });

    it('should check if chain is supported', () => {
      expect(client.isChainSupported(1)).toBe(true);
      expect(client.isChainSupported(42161)).toBe(true);
      expect(client.isChainSupported(999999)).toBe(false);
    });
  });
});
