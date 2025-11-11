/**
 * Tests for PositionListService
 *
 * Tests lightweight position listing with filtering, sorting, and pagination.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import { PositionListService } from './position-list-service.js';
import type { AnyPosition } from '@midcurve/shared';

describe('PositionListService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let service: PositionListService;

  // Test data: Mock database results
  const mockToken0 = {
    id: 'token0-id',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUrl: null,
    coingeckoId: 'usd-coin',
    marketCap: 1000000000,
    config: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1 },
  };

  const mockToken1 = {
    id: 'token1-id',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    tokenType: 'erc20',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoUrl: null,
    coingeckoId: 'weth',
    marketCap: 5000000000,
    config: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chainId: 1 },
  };

  const mockPool = {
    id: 'pool-id',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: 'token0-id',
    token1Id: 'token1-id',
    feeBps: 3000,
    config: { address: '0xPoolAddress', chainId: 1, tickSpacing: 60 },
    state: { sqrtPriceX96: '1000000000000000000', liquidity: '5000000000', tick: 12345 },
    token0: mockToken0,
    token1: mockToken1,
  };

  const mockDbPosition1 = {
    id: 'position-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: 'user-123',
    currentValue: '1500000000',
    currentCostBasis: '1000000000',
    realizedPnl: '0',
    unrealizedPnl: '500000000',
    collectedFees: '25000000',
    unClaimedFees: '5000000',
    lastFeesCollectedAt: new Date('2024-01-10'),
    priceRangeLower: '1500000000',
    priceRangeUpper: '2000000000',
    poolId: 'pool-id',
    pool: mockPool,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-01-01'),
    positionClosedAt: null,
    isActive: true,
    config: { chainId: 1, nftId: 12345, poolAddress: '0xPoolAddress' },
    state: { liquidity: '1000000', tokensOwed0: '100', tokensOwed1: '200' },
  };

  const mockDbPosition2 = {
    id: 'position-2',
    createdAt: new Date('2024-01-05'),
    updatedAt: new Date('2024-01-15'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: 'user-123',
    currentValue: '0',
    currentCostBasis: '2000000000',
    realizedPnl: '-500000000',
    unrealizedPnl: '0',
    collectedFees: '10000000',
    unClaimedFees: '0',
    lastFeesCollectedAt: new Date('2024-01-15'),
    priceRangeLower: '1800000000',
    priceRangeUpper: '2200000000',
    poolId: 'pool-id',
    pool: mockPool,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-01-05'),
    positionClosedAt: new Date('2024-01-15'),
    isActive: false,
    config: { chainId: 1, nftId: 67890, poolAddress: '0xPoolAddress' },
    state: { liquidity: '0', tokensOwed0: '0', tokensOwed1: '0' },
  };

  const mockDbPosition3 = {
    id: 'position-3',
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-10'),
    protocol: 'orca',
    positionType: 'CL_TICKS',
    userId: 'user-123',
    currentValue: '3000000000',
    currentCostBasis: '2500000000',
    realizedPnl: '0',
    unrealizedPnl: '500000000',
    collectedFees: '50000000',
    unClaimedFees: '10000000',
    lastFeesCollectedAt: new Date('2024-01-10'),
    priceRangeLower: '2000000000',
    priceRangeUpper: '2500000000',
    poolId: 'pool-id',
    pool: mockPool,
    isToken0Quote: false,
    positionOpenedAt: new Date('2024-01-10'),
    positionClosedAt: null,
    isActive: true,
    config: { whirlpool: 'SolanaAddressHere' },
    state: { liquidity: '5000000' },
  };

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    service = new PositionListService({
      prisma: prismaMock as unknown as PrismaClient,
    });
  });

  // ==========================================================================
  // List Tests - Default Filters
  // ==========================================================================

  describe('list - default filters', () => {
    it('should return all positions with default filters', async () => {
      // Mock: Find all positions (no filters)
      prismaMock.position.findMany.mockResolvedValue([
        mockDbPosition1,
        mockDbPosition2,
        mockDbPosition3,
      ]);
      prismaMock.position.count.mockResolvedValue(3);

      // Execute
      const result = await service.list('user-123');

      // Verify result structure
      expect(result.positions).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.limit).toBe(20); // Default limit
      expect(result.offset).toBe(0); // Default offset

      // Verify first position structure
      const pos = result.positions[0];
      expect(pos.id).toBe('position-1');
      expect(pos.protocol).toBe('uniswapv3');
      expect(pos.userId).toBe('user-123');

      // Verify bigint conversion
      expect(pos.currentValue).toBe(1500000000n);
      expect(pos.unrealizedPnl).toBe(500000000n);

      // Verify pool is included
      expect(pos.pool.id).toBe('pool-id');
      expect(pos.pool.token0.symbol).toBe('USDC');
      expect(pos.pool.token1.symbol).toBe('WETH');

      // Verify config/state are returned as-is (unknown)
      expect(pos.config).toEqual({ chainId: 1, nftId: 12345, poolAddress: '0xPoolAddress' });
      expect(pos.state).toEqual({ liquidity: '1000000', tokensOwed0: '100', tokensOwed1: '200' });

      // Verify where clause
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
    });
  });

  // ==========================================================================
  // List Tests - Status Filter
  // ==========================================================================

  describe('list - status filter', () => {
    it('should filter by status: active', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition1, mockDbPosition3]);
      prismaMock.position.count.mockResolvedValue(2);

      const result = await service.list('user-123', {
        status: 'active',
      });

      expect(result.positions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.positions.every((p) => p.isActive)).toBe(true);

      // Verify where clause includes isActive: true
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            isActive: true,
          },
        })
      );
    });

    it('should filter by status: closed', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition2]);
      prismaMock.position.count.mockResolvedValue(1);

      const result = await service.list('user-123', {
        status: 'closed',
      });

      expect(result.positions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.positions[0].isActive).toBe(false);

      // Verify where clause includes isActive: false
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            isActive: false,
          },
        })
      );
    });

    it('should return all positions when status is "all"', async () => {
      prismaMock.position.findMany.mockResolvedValue([
        mockDbPosition1,
        mockDbPosition2,
        mockDbPosition3,
      ]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123', {
        status: 'all',
      });

      expect(result.positions).toHaveLength(3);
      expect(result.total).toBe(3);

      // Verify where clause does NOT include isActive filter
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            // No isActive field
          },
        })
      );
    });
  });

  // ==========================================================================
  // List Tests - Protocol Filter
  // ==========================================================================

  describe('list - protocol filter', () => {
    it('should filter by single protocol', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition1, mockDbPosition2]);
      prismaMock.position.count.mockResolvedValue(2);

      const result = await service.list('user-123', {
        protocols: ['uniswapv3'],
      });

      expect(result.positions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.positions.every((p) => p.protocol === 'uniswapv3')).toBe(true);

      // Verify where clause includes protocol filter
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            protocol: {
              in: ['uniswapv3'],
            },
          },
        })
      );
    });

    it('should filter by multiple protocols', async () => {
      prismaMock.position.findMany.mockResolvedValue([
        mockDbPosition1,
        mockDbPosition2,
        mockDbPosition3,
      ]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123', {
        protocols: ['uniswapv3', 'orca'],
      });

      expect(result.positions).toHaveLength(3);
      expect(result.total).toBe(3);

      // Verify where clause includes protocol filter
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            protocol: {
              in: ['uniswapv3', 'orca'],
            },
          },
        })
      );
    });

    it('should return all protocols when protocols filter is empty array', async () => {
      prismaMock.position.findMany.mockResolvedValue([
        mockDbPosition1,
        mockDbPosition2,
        mockDbPosition3,
      ]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123', {
        protocols: [],
      });

      expect(result.positions).toHaveLength(3);

      // Verify where clause does NOT include protocol filter
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            // No protocol field
          },
        })
      );
    });
  });

  // ==========================================================================
  // List Tests - Pagination
  // ==========================================================================

  describe('list - pagination', () => {
    it('should apply pagination (limit and offset)', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition2]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123', {
        limit: 1,
        offset: 1,
      });

      expect(result.positions).toHaveLength(1);
      expect(result.total).toBe(3);
      expect(result.limit).toBe(1);
      expect(result.offset).toBe(1);

      // Verify pagination parameters
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
          skip: 1,
        })
      );
    });

    it('should validate limit (max 100)', async () => {
      prismaMock.position.findMany.mockResolvedValue([]);
      prismaMock.position.count.mockResolvedValue(0);

      const result = await service.list('user-123', {
        limit: 200, // Too high
      });

      expect(result.limit).toBe(100); // Clamped to max

      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });

    it('should validate limit (min 1)', async () => {
      prismaMock.position.findMany.mockResolvedValue([]);
      prismaMock.position.count.mockResolvedValue(0);

      const result = await service.list('user-123', {
        limit: 0, // Too low
      });

      expect(result.limit).toBe(1); // Clamped to min

      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
        })
      );
    });

    it('should validate offset (min 0)', async () => {
      prismaMock.position.findMany.mockResolvedValue([]);
      prismaMock.position.count.mockResolvedValue(0);

      const result = await service.list('user-123', {
        offset: -10, // Negative
      });

      expect(result.offset).toBe(0); // Clamped to min

      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
        })
      );
    });
  });

  // ==========================================================================
  // List Tests - Sorting
  // ==========================================================================

  describe('list - sorting', () => {
    it('should sort by createdAt desc (default)', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition3, mockDbPosition2, mockDbPosition1]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123');

      expect(result.positions).toHaveLength(3);

      // Verify orderBy
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            createdAt: 'desc',
          },
        })
      );
    });

    it('should sort by currentValue asc', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition2, mockDbPosition1, mockDbPosition3]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123', {
        sortBy: 'currentValue',
        sortDirection: 'asc',
      });

      expect(result.positions).toHaveLength(3);

      // Verify orderBy
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            currentValue: 'asc',
          },
        })
      );
    });

    it('should sort by unrealizedPnl desc', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition1, mockDbPosition3, mockDbPosition2]);
      prismaMock.position.count.mockResolvedValue(3);

      const result = await service.list('user-123', {
        sortBy: 'unrealizedPnl',
        sortDirection: 'desc',
      });

      expect(result.positions).toHaveLength(3);

      // Verify orderBy
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            unrealizedPnl: 'desc',
          },
        })
      );
    });
  });

  // ==========================================================================
  // List Tests - Combined Filters
  // ==========================================================================

  describe('list - combined filters', () => {
    it('should apply multiple filters simultaneously', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition1]);
      prismaMock.position.count.mockResolvedValue(1);

      const result = await service.list('user-123', {
        status: 'active',
        protocols: ['uniswapv3'],
        limit: 10,
        offset: 0,
        sortBy: 'currentValue',
        sortDirection: 'desc',
      });

      expect(result.positions).toHaveLength(1);
      expect(result.total).toBe(1);

      // Verify all filters applied
      expect(prismaMock.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            isActive: true,
            protocol: {
              in: ['uniswapv3'],
            },
          },
          orderBy: {
            currentValue: 'desc',
          },
          take: 10,
          skip: 0,
        })
      );
    });
  });

  // ==========================================================================
  // List Tests - Type Safety
  // ==========================================================================

  describe('list - type safety', () => {
    it('should return positions with config/state as unknown', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition1]);
      prismaMock.position.count.mockResolvedValue(1);

      const result = await service.list('user-123');

      // Type check: config and state should be unknown
      const position = result.positions[0] as AnyPosition;
      expect(position.config).toBeDefined();
      expect(position.state).toBeDefined();

      // Verify they are NOT parsed (remain as-is from database)
      expect(position.config).toEqual({
        chainId: 1,
        nftId: 12345,
        poolAddress: '0xPoolAddress',
      });
      expect(position.state).toEqual({
        liquidity: '1000000',
        tokensOwed0: '100',
        tokensOwed1: '200',
      });
    });

    it('should NOT include poolId in result', async () => {
      prismaMock.position.findMany.mockResolvedValue([mockDbPosition1]);
      prismaMock.position.count.mockResolvedValue(1);

      const result = await service.list('user-123');

      const position = result.positions[0] as any;

      // Verify poolId is NOT in the result (only pool object)
      expect(position.poolId).toBeUndefined();
      expect(position.pool).toBeDefined();
      expect(position.pool.id).toBe('pool-id');
    });
  });
});
