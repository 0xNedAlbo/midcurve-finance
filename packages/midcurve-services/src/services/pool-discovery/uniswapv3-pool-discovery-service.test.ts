/**
 * Tests for UniswapV3PoolDiscoveryService
 *
 * Unit tests covering pool discovery, metrics enrichment, and error handling.
 * All external dependencies (RPC, database, subgraph) are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import type { PublicClient } from 'viem';
import { UniswapV3PoolDiscoveryService } from './uniswapv3-pool-discovery-service.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/uniswapv3-subgraph-client.js';
import {
  UniswapV3SubgraphApiError,
  UniswapV3SubgraphUnavailableError,
  PoolNotFoundInSubgraphError,
} from '../../clients/subgraph/uniswapv3/types.js';
import { EvmConfig } from '../../config/evm.js';
import {
  WETH_USDC_INPUT,
  LOWERCASE_ADDRESSES_INPUT,
  REVERSED_TOKEN_ORDER_INPUT,
  INVALID_TOKEN_A_INPUT,
  INVALID_TOKEN_B_INPUT,
  UNSUPPORTED_CHAIN_INPUT,
  MOCK_POOL_METRICS,
  KNOWN_TOKEN_PAIRS,
} from './test-fixtures.js';
import type { UniswapV3Pool } from '@midcurve/shared';

describe('UniswapV3PoolDiscoveryService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let poolServiceMock: DeepMockProxy<UniswapV3PoolService>;
  let subgraphClientMock: DeepMockProxy<UniswapV3SubgraphClient>;
  let evmConfigMock: DeepMockProxy<EvmConfig>;
  let publicClientMock: DeepMockProxy<PublicClient>;
  let service: UniswapV3PoolDiscoveryService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    poolServiceMock = mockDeep<UniswapV3PoolService>();
    subgraphClientMock = mockDeep<UniswapV3SubgraphClient>();
    evmConfigMock = mockDeep<EvmConfig>();
    publicClientMock = mockDeep<PublicClient>();

    // Mock EVM config to return mocked public client
    evmConfigMock.getPublicClient.mockReturnValue(
      publicClientMock as unknown as PublicClient
    );
    evmConfigMock.isChainSupported.mockReturnValue(true);

    service = new UniswapV3PoolDiscoveryService({
      prisma: prismaMock as unknown as PrismaClient,
      poolService: poolServiceMock as unknown as UniswapV3PoolService,
      subgraphClient:
        subgraphClientMock as unknown as UniswapV3SubgraphClient,
      evmConfig: evmConfigMock as unknown as EvmConfig,
    });
  });

  // ==========================================================================
  // Pool Name Generation Tests
  // ==========================================================================

  describe('createPoolName', () => {
    it('should create pool name with tick spacing 10 (0.05% fee)', () => {
      const mockPool = {
        token0: { symbol: 'USDC' },
        token1: { symbol: 'WETH' },
        config: { tickSpacing: 10 },
      } as UniswapV3Pool;

      const poolName = service.createPoolName(mockPool);

      expect(poolName).toBe('CL10-USDC/WETH');
    });

    it('should create pool name with tick spacing 60 (0.3% fee)', () => {
      const mockPool = {
        token0: { symbol: 'DAI' },
        token1: { symbol: 'USDC' },
        config: { tickSpacing: 60 },
      } as UniswapV3Pool;

      const poolName = service.createPoolName(mockPool);

      expect(poolName).toBe('CL60-DAI/USDC');
    });

    it('should create pool name with tick spacing 200 (1% fee)', () => {
      const mockPool = {
        token0: { symbol: 'USDC' },
        token1: { symbol: 'WETH' },
        config: { tickSpacing: 200 },
      } as UniswapV3Pool;

      const poolName = service.createPoolName(mockPool);

      expect(poolName).toBe('CL200-USDC/WETH');
    });

    it('should create pool name with tick spacing 1 (0.01% fee)', () => {
      const mockPool = {
        token0: { symbol: 'USDC' },
        token1: { symbol: 'USDT' },
        config: { tickSpacing: 1 },
      } as UniswapV3Pool;

      const poolName = service.createPoolName(mockPool);

      expect(poolName).toBe('CL1-USDC/USDT');
    });
  });

  // ==========================================================================
  // Input Validation Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Input Validation', () => {
    it('should throw error for invalid tokenA address', async () => {
      await expect(
        service.findPoolsForTokenPair(INVALID_TOKEN_A_INPUT)
      ).rejects.toThrow('Invalid tokenA address');
    });

    it('should throw error for invalid tokenB address', async () => {
      await expect(
        service.findPoolsForTokenPair(INVALID_TOKEN_B_INPUT)
      ).rejects.toThrow('Invalid tokenB address');
    });

    it('should throw error for unsupported chain', async () => {
      evmConfigMock.isChainSupported.mockReturnValue(false);

      await expect(
        service.findPoolsForTokenPair(UNSUPPORTED_CHAIN_INPUT)
      ).rejects.toThrow('Chain 999999 is not supported');
    });
  });

  // ==========================================================================
  // Address Normalization Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Address Normalization', () => {
    it('should normalize lowercase addresses', async () => {
      // Mock factory to return zero addresses (no pools)
      publicClientMock.readContract.mockResolvedValue(
        '0x0000000000000000000000000000000000000000'
      );

      const results = await service.findPoolsForTokenPair(
        LOWERCASE_ADDRESSES_INPUT
      );

      // Should have called factory with normalized addresses
      expect(publicClientMock.readContract).toHaveBeenCalled();
      expect(results).toHaveLength(0);
    });

    it('should sort token addresses (token0 < token1)', async () => {
      // Mock factory to return zero addresses (no pools)
      publicClientMock.readContract.mockResolvedValue(
        '0x0000000000000000000000000000000000000000'
      );

      await service.findPoolsForTokenPair(REVERSED_TOKEN_ORDER_INPUT);

      // Should have called factory with sorted addresses (USDC < WETH)
      const calls = publicClientMock.readContract.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      // Check that token0 < token1 in all calls
      calls.forEach((call) => {
        const args = call[0]!.args as [string, string, number];
        const [token0, token1] = args;
        // String comparison: token0 should be lexicographically less than token1
        expect(token0!.toLowerCase() < token1!.toLowerCase()).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Pool Discovery Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Pool Discovery', () => {
    it('should discover pools for all fee tiers', async () => {
      const { expectedPools } = KNOWN_TOKEN_PAIRS.WETH_USDC_ETHEREUM;

      // Mock factory to return pool addresses for each fee tier
      publicClientMock.readContract
        .mockResolvedValueOnce(expectedPools[0]!.poolAddress) // 500 bps
        .mockResolvedValueOnce(expectedPools[1]!.poolAddress) // 3000 bps
        .mockResolvedValueOnce(expectedPools[2]!.poolAddress) // 10000 bps
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000'); // 100 bps (doesn't exist)

      // Mock pool discovery
      expectedPools.forEach((expectedPool, index) => {
        const mockPool = {
          id: `pool_${index}`,
          protocol: 'uniswapv3',
          token0: { symbol: 'USDC' },
          token1: { symbol: 'WETH' },
          config: {
            poolAddress: expectedPool.poolAddress,
            tickSpacing: expectedPool.tickSpacing,
          },
        } as unknown as UniswapV3Pool;

        poolServiceMock.discover.mockResolvedValueOnce(mockPool);
      });

      // Mock subgraph metrics
      subgraphClientMock.getPoolMetrics
        .mockResolvedValueOnce(MOCK_POOL_METRICS.HIGH_TVL)
        .mockResolvedValueOnce(MOCK_POOL_METRICS.MEDIUM_TVL)
        .mockResolvedValueOnce(MOCK_POOL_METRICS.LOW_TVL);

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      // Should discover 3 pools (not 4, since 100 bps doesn't exist)
      expect(results).toHaveLength(3);

      // Check that pool discovery was called for each existing pool
      expect(poolServiceMock.discover).toHaveBeenCalledTimes(3);

      // Check that results are sorted by TVL descending
      expect(parseFloat(results[0]!.tvlUSD)).toBeGreaterThan(
        parseFloat(results[1]!.tvlUSD)
      );
      expect(parseFloat(results[1]!.tvlUSD)).toBeGreaterThan(
        parseFloat(results[2]!.tvlUSD)
      );
    });

    it('should return empty array when no pools exist', async () => {
      // Mock factory to return zero addresses for all fee tiers
      publicClientMock.readContract.mockResolvedValue(
        '0x0000000000000000000000000000000000000000'
      );

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      expect(results).toHaveLength(0);
      expect(poolServiceMock.discover).not.toHaveBeenCalled();
      expect(subgraphClientMock.getPoolMetrics).not.toHaveBeenCalled();
    });

    it('should query factory for all 4 fee tiers (100, 500, 3000, 10000)', async () => {
      // Mock factory to return zero addresses (no pools)
      publicClientMock.readContract.mockResolvedValue(
        '0x0000000000000000000000000000000000000000'
      );

      await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      // Should have called factory 4 times (one per fee tier)
      expect(publicClientMock.readContract).toHaveBeenCalledTimes(4);

      // Check that it queried all fee tiers
      const calls = publicClientMock.readContract.mock.calls;
      const fees = calls.map((call) => call[0]!.args![2]);
      expect(fees).toContain(100);
      expect(fees).toContain(500);
      expect(fees).toContain(3000);
      expect(fees).toContain(10000);
    });
  });

  // ==========================================================================
  // Subgraph Enrichment Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Subgraph Enrichment', () => {
    beforeEach(() => {
      // Mock factory to return one pool
      publicClientMock.readContract
        .mockResolvedValueOnce('0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640')
        .mockResolvedValue('0x0000000000000000000000000000000000000000');

      // Mock pool discovery
      poolServiceMock.discover.mockResolvedValue({
        id: 'pool_1',
        protocol: 'uniswapv3',
        token0: { symbol: 'USDC' },
        token1: { symbol: 'WETH' },
        config: {
          poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
          tickSpacing: 10,
        },
      } as unknown as UniswapV3Pool);
    });

    it('should enrich pools with subgraph metrics', async () => {
      subgraphClientMock.getPoolMetrics.mockResolvedValue(
        MOCK_POOL_METRICS.HIGH_TVL
      );

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      expect(results).toHaveLength(1);
      expect(results[0]!.tvlUSD).toBe(MOCK_POOL_METRICS.HIGH_TVL.tvlUSD);
      expect(results[0]!.volumeUSD).toBe(MOCK_POOL_METRICS.HIGH_TVL.volumeUSD);
      expect(results[0]!.feesUSD).toBe(MOCK_POOL_METRICS.HIGH_TVL.feesUSD);
    });

    it('should fail when subgraph returns API error', async () => {
      subgraphClientMock.getPoolMetrics.mockRejectedValue(
        new UniswapV3SubgraphApiError('Subgraph API error', 500)
      );

      await expect(
        service.findPoolsForTokenPair(WETH_USDC_INPUT)
      ).rejects.toThrow(UniswapV3SubgraphApiError);
    });

    it('should use default metrics when subgraph is unavailable', async () => {
      subgraphClientMock.getPoolMetrics.mockRejectedValue(
        new UniswapV3SubgraphUnavailableError('Network timeout')
      );

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      expect(results).toHaveLength(1);
      expect(results[0]!.tvlUSD).toBe('0');
      expect(results[0]!.volumeUSD).toBe('0');
      expect(results[0]!.feesUSD).toBe('0');
    });

    it('should use default metrics when pool not found in subgraph', async () => {
      subgraphClientMock.getPoolMetrics.mockRejectedValue(
        new PoolNotFoundInSubgraphError(
          1,
          '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
        )
      );

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      expect(results).toHaveLength(1);
      expect(results[0]!.tvlUSD).toBe('0');
      expect(results[0]!.volumeUSD).toBe('0');
      expect(results[0]!.feesUSD).toBe('0');
    });
  });

  // ==========================================================================
  // TVL Sorting Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - TVL Sorting', () => {
    it('should sort results by TVL descending', async () => {
      // Use real pool addresses from fixtures
      const { expectedPools } = KNOWN_TOKEN_PAIRS.WETH_USDC_ETHEREUM;

      // Mock factory to return 3 pools
      publicClientMock.readContract
        .mockResolvedValueOnce(expectedPools[0]!.poolAddress)
        .mockResolvedValueOnce(expectedPools[1]!.poolAddress)
        .mockResolvedValueOnce(expectedPools[2]!.poolAddress)
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000');

      // Mock pool discovery for 3 pools
      for (let i = 0; i < 3; i++) {
        poolServiceMock.discover.mockResolvedValueOnce({
          id: `pool_${i}`,
          protocol: 'uniswapv3',
          token0: { symbol: 'USDC' },
          token1: { symbol: 'WETH' },
          config: {
            address: expectedPools[i]!.poolAddress,
            tickSpacing: expectedPools[i]!.tickSpacing,
          },
        } as unknown as UniswapV3Pool);
      }

      // Mock subgraph metrics in non-sorted order
      subgraphClientMock.getPoolMetrics
        .mockResolvedValueOnce(MOCK_POOL_METRICS.MEDIUM_TVL) // Pool 1: Medium TVL
        .mockResolvedValueOnce(MOCK_POOL_METRICS.HIGH_TVL) // Pool 2: High TVL
        .mockResolvedValueOnce(MOCK_POOL_METRICS.LOW_TVL); // Pool 3: Low TVL

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      expect(results).toHaveLength(3);

      // Should be sorted by TVL descending
      expect(results[0]!.tvlUSD).toBe(MOCK_POOL_METRICS.HIGH_TVL.tvlUSD);
      expect(results[1]!.tvlUSD).toBe(MOCK_POOL_METRICS.MEDIUM_TVL.tvlUSD);
      expect(results[2]!.tvlUSD).toBe(MOCK_POOL_METRICS.LOW_TVL.tvlUSD);
    });
  });

  // ==========================================================================
  // Pool Name Format Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Pool Names', () => {
    it('should generate correct pool names for discovered pools', async () => {
      // Use real pool addresses from fixtures
      const { expectedPools } = KNOWN_TOKEN_PAIRS.WETH_USDC_ETHEREUM;

      // Mock factory to return 2 pools
      publicClientMock.readContract
        .mockResolvedValueOnce(expectedPools[0]!.poolAddress)
        .mockResolvedValueOnce(expectedPools[1]!.poolAddress)
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000');

      // Mock pool discovery for 2 pools with different tick spacings
      poolServiceMock.discover
        .mockResolvedValueOnce({
          id: 'pool_1',
          protocol: 'uniswapv3',
          token0: { symbol: 'USDC' },
          token1: { symbol: 'WETH' },
          config: {
            address: expectedPools[0]!.poolAddress,
            tickSpacing: expectedPools[0]!.tickSpacing, // 0.05% fee
          },
        } as unknown as UniswapV3Pool)
        .mockResolvedValueOnce({
          id: 'pool_2',
          protocol: 'uniswapv3',
          token0: { symbol: 'USDC' },
          token1: { symbol: 'WETH' },
          config: {
            address: expectedPools[1]!.poolAddress,
            tickSpacing: expectedPools[1]!.tickSpacing, // 0.3% fee
          },
        } as unknown as UniswapV3Pool);

      // Mock subgraph metrics
      subgraphClientMock.getPoolMetrics.mockResolvedValue(
        MOCK_POOL_METRICS.ZERO_METRICS
      );

      const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

      expect(results).toHaveLength(2);
      // expectedPools[0] has tickSpacing 10, expectedPools[1] has tickSpacing 60
      expect(results[0]!.poolName).toBe(`CL${expectedPools[0]!.tickSpacing}-USDC/WETH`);
      expect(results[1]!.poolName).toBe(`CL${expectedPools[1]!.tickSpacing}-USDC/WETH`);
    });
  });
});
