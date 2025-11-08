/**
 * UniswapV3SubgraphClient Unit Tests
 *
 * Tests for The Graph subgraph client with mocked HTTP responses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { UniswapV3SubgraphClient } from './uniswapv3-subgraph-client.js';
import { CacheService } from '../../../services/cache/index.js';
import type { SubgraphResponse, RawPoolData } from './types.js';
import {
  UniswapV3SubgraphApiError,
  UniswapV3SubgraphUnavailableError,
  PoolNotFoundInSubgraphError,
} from './types.js';

describe('UniswapV3SubgraphClient', () => {
  let client: UniswapV3SubgraphClient;
  let cacheServiceMock: DeepMockProxy<CacheService>;
  let fetchMock: ReturnType<typeof vi.fn>;

  // Test pool address (USDC/WETH 0.05% pool on Ethereum)
  const POOL_ADDRESS = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
  const CHAIN_ID = 1; // Ethereum

  // Store original env var
  const originalApiKey = process.env.THE_GRAPH_API_KEY;

  beforeEach(() => {
    // Set test API key for unit tests
    process.env.THE_GRAPH_API_KEY = 'test_api_key_for_unit_tests';

    // Reset singleton
    UniswapV3SubgraphClient.resetInstance();

    // Create mocks
    cacheServiceMock = mockDeep<CacheService>();
    fetchMock = vi.fn();

    // Create client with mocks
    client = new UniswapV3SubgraphClient({
      cacheService: cacheServiceMock,
      fetch: fetchMock as unknown as typeof fetch,
    });
  });

  afterEach(() => {
    // Restore original API key
    if (originalApiKey !== undefined) {
      process.env.THE_GRAPH_API_KEY = originalApiKey;
    } else {
      delete process.env.THE_GRAPH_API_KEY;
    }

    vi.clearAllMocks();
  });

  describe('getInstance()', () => {
    it('should return singleton instance', () => {
      const instance1 = UniswapV3SubgraphClient.getInstance();
      const instance2 = UniswapV3SubgraphClient.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after resetInstance()', () => {
      const instance1 = UniswapV3SubgraphClient.getInstance();
      UniswapV3SubgraphClient.resetInstance();
      const instance2 = UniswapV3SubgraphClient.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('isChainSupported()', () => {
    it('should return true for Ethereum', () => {
      expect(client.isChainSupported(1)).toBe(true);
    });

    it('should return true for Arbitrum', () => {
      expect(client.isChainSupported(42161)).toBe(true);
    });

    it('should return true for Base', () => {
      expect(client.isChainSupported(8453)).toBe(true);
    });

    it('should return false for unsupported chain', () => {
      expect(client.isChainSupported(999)).toBe(false);
    });
  });

  describe('getSupportedChainIds()', () => {
    it('should return array of supported chain IDs', () => {
      const chains = client.getSupportedChainIds();

      expect(chains).toContain(1); // Ethereum
      expect(chains).toContain(42161); // Arbitrum
      expect(chains).toContain(8453); // Base
      expect(chains.length).toBeGreaterThan(0);
    });
  });

  describe('query()', () => {
    const mockQuery = 'query { pools { id } }';
    const mockVariables = { poolId: '0x123' };

    it('should return cached response if available', async () => {
      const cachedResponse: SubgraphResponse<{ pools: [] }> = {
        data: { pools: [] },
      };

      cacheServiceMock.get.mockResolvedValue(cachedResponse);

      const result = await client.query(CHAIN_ID, mockQuery, mockVariables);

      expect(result).toBe(cachedResponse);
      expect(cacheServiceMock.get).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch from subgraph if not cached', async () => {
      const mockResponse: SubgraphResponse<{ pools: [] }> = {
        data: { pools: [] },
      };

      cacheServiceMock.get.mockResolvedValue(null); // Cache miss
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.query(CHAIN_ID, mockQuery, mockVariables);

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cacheServiceMock.set).toHaveBeenCalledTimes(1);
    });

    it('should cache successful responses', async () => {
      const mockResponse: SubgraphResponse<{ pools: [] }> = {
        data: { pools: [] },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await client.query(CHAIN_ID, mockQuery, mockVariables);

      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        expect.stringContaining('subgraph:uniswapv3:'),
        mockResponse,
        300 // 5 minutes TTL
      );
    });

    it('should not cache responses with errors', async () => {
      const mockResponse: SubgraphResponse<{ pools: [] }> = {
        data: { pools: [] },
        errors: [{ message: 'Some error' }],
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await client.query(CHAIN_ID, mockQuery, mockVariables);

      expect(cacheServiceMock.set).not.toHaveBeenCalled();
    });

    it('should throw error for unsupported chain', async () => {
      await expect(client.query(999, mockQuery, mockVariables)).rejects.toThrow(
        'Uniswap V3 subgraph not available for chain 999'
      );
    });

    it('should throw UniswapV3SubgraphApiError for HTTP errors', async () => {
      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.query(CHAIN_ID, mockQuery, mockVariables)).rejects.toThrow(
        'Subgraph HTTP error: 500 Internal Server Error'
      );
    });

    it('should retry on network errors', async () => {
      cacheServiceMock.get.mockResolvedValue(null);

      // Fail twice, then succeed
      fetchMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { pools: [] } }),
        });

      const result = await client.query(CHAIN_ID, mockQuery, mockVariables);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.data).toEqual({ pools: [] });
    });

    it('should throw UniswapV3SubgraphUnavailableError after max retries', async () => {
      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockRejectedValue(new Error('Network error'));

      await expect(client.query(CHAIN_ID, mockQuery, mockVariables)).rejects.toThrow(
        'Subgraph unavailable after 3 attempts'
      );

      expect(fetchMock).toHaveBeenCalledTimes(3); // Max retries
    });
  });

  describe('getPoolMetrics()', () => {
    it('should return pool metrics from subgraph', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: {
          pools: [
            {
              id: POOL_ADDRESS.toLowerCase(),
              feeTier: '500',
              sqrtPrice: '1234567890',
              liquidity: '9876543210',
              token0: { id: '0xa0b8...', symbol: 'USDC', decimals: '6' },
              token1: { id: '0xc02a...', symbol: 'WETH', decimals: '18' },
              poolDayData: [
                {
                  date: Date.now() / 1000,
                  liquidity: '9876543210',
                  volumeToken0: '1234567',
                  volumeToken1: '987654',
                  token0Price: '0.0005',
                  token1Price: '2000',
                  volumeUSD: '10000000',
                  feesUSD: '5000',
                  tvlUSD: '50000000',
                },
              ],
            },
          ],
        },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const metrics = await client.getPoolMetrics(CHAIN_ID, POOL_ADDRESS);

      expect(metrics).toEqual({
        tvlUSD: '50000000',
        volumeUSD: '10000000',
        feesUSD: '5000',
      });
    });

    it('should return default metrics if pool not found', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: { pools: [] },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const metrics = await client.getPoolMetrics(CHAIN_ID, POOL_ADDRESS);

      expect(metrics).toEqual({
        tvlUSD: '0',
        volumeUSD: '0',
        feesUSD: '0',
      });
    });

    it('should return default metrics if no pool day data', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: {
          pools: [
            {
              id: POOL_ADDRESS.toLowerCase(),
              feeTier: '500',
              sqrtPrice: '1234567890',
              liquidity: '9876543210',
              token0: { id: '0xa0b8...', symbol: 'USDC', decimals: '6' },
              token1: { id: '0xc02a...', symbol: 'WETH', decimals: '18' },
              poolDayData: [], // No data
            },
          ],
        },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const metrics = await client.getPoolMetrics(CHAIN_ID, POOL_ADDRESS);

      expect(metrics).toEqual({
        tvlUSD: '0',
        volumeUSD: '0',
        feesUSD: '0',
      });
    });

    it('should throw error if subgraph returns GraphQL errors', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: null,
        errors: [{ message: 'Query timeout' }],
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await expect(client.getPoolMetrics(CHAIN_ID, POOL_ADDRESS)).rejects.toThrow(
        'Subgraph query failed'
      );
    });

    it('should normalize pool address to lowercase', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: { pools: [] },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // Use mixed case (valid checksum format)
      await client.getPoolMetrics(CHAIN_ID, POOL_ADDRESS);

      const fetchCall = fetchMock.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);
      expect(body.variables.poolId).toBe(POOL_ADDRESS.toLowerCase());
    });
  });

  describe('getPoolFeeData()', () => {
    it('should return detailed pool fee data', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: {
          pools: [
            {
              id: POOL_ADDRESS.toLowerCase(),
              feeTier: '500',
              sqrtPrice: '1234567890123456789',
              liquidity: '9876543210123456789',
              token0: { id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: '6' },
              token1: { id: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: '18' },
              poolDayData: [
                {
                  date: Date.now() / 1000,
                  liquidity: '9876543210',
                  volumeToken0: '1234567.89',
                  volumeToken1: '987.654321',
                  token0Price: '0.0005',
                  token1Price: '2000.5',
                  volumeUSD: '10000000',
                  feesUSD: '5000',
                  tvlUSD: '50000000',
                },
              ],
            },
          ],
        },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const feeData = await client.getPoolFeeData(CHAIN_ID, POOL_ADDRESS);

      expect(feeData.poolAddress).toBe(POOL_ADDRESS);
      expect(feeData.chainId).toBe(CHAIN_ID);
      expect(feeData.feeTier).toBe('500');
      expect(feeData.poolLiquidity).toBe('9876543210123456789');
      expect(feeData.token0.symbol).toBe('USDC');
      expect(feeData.token1.symbol).toBe('WETH');
      expect(feeData.token0.decimals).toBe(6);
      expect(feeData.token1.decimals).toBe(18);
      expect(feeData.calculatedAt).toBeInstanceOf(Date);
    });

    it('should throw PoolNotFoundInSubgraphError if pool not found', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: { pools: [] },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await expect(client.getPoolFeeData(CHAIN_ID, POOL_ADDRESS)).rejects.toThrow(
        'Pool 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640 not found in subgraph'
      );
    });

    it('should throw error if no pool day data available', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: {
          pools: [
            {
              id: POOL_ADDRESS.toLowerCase(),
              feeTier: '500',
              sqrtPrice: '1234567890',
              liquidity: '9876543210',
              token0: { id: '0xa0b8...', symbol: 'USDC', decimals: '6' },
              token1: { id: '0xc02a...', symbol: 'WETH', decimals: '18' },
              poolDayData: [], // No data
            },
          ],
        },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await expect(client.getPoolFeeData(CHAIN_ID, POOL_ADDRESS)).rejects.toThrow(
        'No recent pool data available'
      );
    });
  });

  describe('clearCache()', () => {
    it('should clear subgraph caches', async () => {
      cacheServiceMock.clear.mockResolvedValue(5);

      const cleared = await client.clearCache();

      expect(cleared).toBe(5);
      expect(cacheServiceMock.clear).toHaveBeenCalledWith('subgraph:uniswapv3:');
    });
  });

  describe('decimalToBigIntString()', () => {
    it('should convert decimal to bigint string', async () => {
      // We'll test this indirectly through getPoolFeeData
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: {
          pools: [
            {
              id: POOL_ADDRESS.toLowerCase(),
              feeTier: '500',
              sqrtPrice: '1234567890',
              liquidity: '9876543210',
              token0: { id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: '6' },
              token1: { id: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: '18' },
              poolDayData: [
                {
                  date: Date.now() / 1000,
                  liquidity: '9876543210',
                  volumeToken0: '1000.5', // Should become 1000500000 (6 decimals)
                  volumeToken1: '1.5', // Should become 1500000000000000000 (18 decimals)
                  token0Price: '0.0005',
                  token1Price: '2000',
                  volumeUSD: '10000000',
                  feesUSD: '5000',
                  tvlUSD: '50000000',
                },
              ],
            },
          ],
        },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const feeData = await client.getPoolFeeData(CHAIN_ID, POOL_ADDRESS);

      // Check decimal conversion
      expect(feeData.token0.dailyVolume).toBe('1000500000'); // 1000.5 * 10^6
      expect(feeData.token1.dailyVolume).toBe('1500000000000000000'); // 1.5 * 10^18
    });

    it('should handle zero values', async () => {
      const mockResponse: SubgraphResponse<{ pools: RawPoolData[] }> = {
        data: {
          pools: [
            {
              id: POOL_ADDRESS.toLowerCase(),
              feeTier: '500',
              sqrtPrice: '1234567890',
              liquidity: '9876543210',
              token0: { id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: '6' },
              token1: { id: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: '18' },
              poolDayData: [
                {
                  date: Date.now() / 1000,
                  liquidity: '9876543210',
                  volumeToken0: '0',
                  volumeToken1: '0',
                  token0Price: '0',
                  token1Price: '0',
                  volumeUSD: '0',
                  feesUSD: '0',
                  tvlUSD: '0',
                },
              ],
            },
          ],
        },
      };

      cacheServiceMock.get.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const feeData = await client.getPoolFeeData(CHAIN_ID, POOL_ADDRESS);

      expect(feeData.token0.dailyVolume).toBe('0');
      expect(feeData.token1.dailyVolume).toBe('0');
    });
  });
});
