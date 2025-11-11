/**
 * Comprehensive tests for abstract PoolPriceService
 * Tests base CRUD operations with a concrete test implementation
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import { PoolPriceService } from './pool-price-service.js';
import type {
  UniswapV3PoolPriceConfig,
  UniswapV3PoolPriceState,
} from '@midcurve/shared';
import type {
  CreatePoolPriceInput,
  UpdatePoolPriceInput,
  UniswapV3PoolPriceDiscoverInput,
} from '../types/pool-price/pool-price-input.js';
import type { UniswapV3PoolPrice } from '@midcurve/shared';
import {
  WETH_USDC_POOL_PRICE_ARBITRUM,
  WBTC_USDC_POOL_PRICE_ARBITRUM,
  USDC_USDT_POOL_PRICE,
  WETH_USDC_POOL_PRICE_EARLIER,
  WETH_USDC_POOL_PRICE_LATER,
  MINIMAL_POOL_PRICE,
  createPoolPriceFixture,
} from './test-fixtures.js';

/**
 * Concrete test implementation of PoolPriceService
 * Uses 'uniswapv3' protocol for testing abstract methods
 */
class TestPoolPriceService extends PoolPriceService<'uniswapv3'> {
  parseConfig(configDB: unknown): UniswapV3PoolPriceConfig {
    const db = configDB as { blockNumber: number; blockTimestamp: number };
    return {
      blockNumber: db.blockNumber,
      blockTimestamp: db.blockTimestamp,
    };
  }

  serializeConfig(config: UniswapV3PoolPriceConfig): unknown {
    return {
      blockNumber: config.blockNumber,
      blockTimestamp: config.blockTimestamp,
    };
  }

  parseState(stateDB: unknown): UniswapV3PoolPriceState {
    const db = stateDB as { sqrtPriceX96: string; tick: number };
    return {
      sqrtPriceX96: BigInt(db.sqrtPriceX96),
      tick: db.tick,
    };
  }

  serializeState(state: UniswapV3PoolPriceState): unknown {
    return {
      sqrtPriceX96: state.sqrtPriceX96.toString(),
      tick: state.tick,
    };
  }

  async discover(
    poolId: string,
    params: UniswapV3PoolPriceDiscoverInput
  ): Promise<UniswapV3PoolPrice> {
    // Simple test implementation
    return this.create({
      protocol: 'uniswapv3',
      poolId,
      timestamp: new Date(),
      token1PricePerToken0: 1n,
      token0PricePerToken1: 1n,
      config: {
        blockNumber: params.blockNumber,
        blockTimestamp: Date.now() / 1000,
      },
      state: {
        sqrtPriceX96: 79228162514264337593543950336n,
        tick: 0,
      },
    });
  }
}

describe('PoolPriceService (Abstract Base)', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let poolPriceService: TestPoolPriceService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    poolPriceService = new TestPoolPriceService({
      prisma: prismaMock as unknown as PrismaClient,
    });
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with provided Prisma client', () => {
      const service = new TestPoolPriceService({
        prisma: prismaMock as unknown as PrismaClient,
      });
      expect(service).toBeInstanceOf(TestPoolPriceService);
      expect(service).toBeInstanceOf(PoolPriceService);
    });

    it('should create instance with default Prisma client when not provided', () => {
      const service = new TestPoolPriceService();
      expect(service).toBeInstanceOf(TestPoolPriceService);
    });

    it('should accept empty dependencies object', () => {
      const service = new TestPoolPriceService({});
      expect(service).toBeInstanceOf(TestPoolPriceService);
    });
  });

  // ==========================================================================
  // create Method Tests
  // ==========================================================================

  describe('create', () => {
    it('should create pool price with valid input', async () => {
      // Arrange
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: {
          blockNumber: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config.blockNumber,
          blockTimestamp: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config.blockTimestamp,
        },
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.create.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.create(WETH_USDC_POOL_PRICE_ARBITRUM.input);

      // Assert
      expect(result.id).toBe(WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.id);
      expect(result.protocol).toBe('uniswapv3');
      expect(result.poolId).toBe(WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.poolId);
      expect(result.token1PricePerToken0).toBe(WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0);
      expect(result.token0PricePerToken1).toBe(WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1);
      expect(result.config.blockNumber).toBe(18000000);
      expect(result.state.sqrtPriceX96).toBe(4880027310900678652549898n);
      expect(result.state.tick).toBe(-193909);
      expect(prismaMock.poolPrice.create).toHaveBeenCalledTimes(1);
    });

    it('should create pool price with WBTC/USDC data', async () => {
      // Arrange
      const mockDbResult = {
        ...WBTC_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WBTC_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WBTC_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WBTC_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WBTC_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WBTC_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.create.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.create(WBTC_USDC_POOL_PRICE_ARBITRUM.input);

      // Assert
      expect(result.token1PricePerToken0).toBe(107245_354183n);
      expect(result.state.sqrtPriceX96).toBe(2594590524261178691684425401086n);
      expect(result.state.tick).toBe(69780);
    });

    it('should create pool price with 1:1 stablecoin ratio', async () => {
      // Arrange
      const mockDbResult = {
        ...USDC_USDT_POOL_PRICE.dbResult,
        token1PricePerToken0: USDC_USDT_POOL_PRICE.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: USDC_USDT_POOL_PRICE.dbResult.token0PricePerToken1.toString(),
        config: USDC_USDT_POOL_PRICE.dbResult.config,
        state: {
          sqrtPriceX96: USDC_USDT_POOL_PRICE.dbResult.state.sqrtPriceX96.toString(),
          tick: USDC_USDT_POOL_PRICE.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.create.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.create(USDC_USDT_POOL_PRICE.input);

      // Assert
      expect(result.token1PricePerToken0).toBe(1_000000n);
      expect(result.token0PricePerToken1).toBe(1_000000n);
      expect(result.state.sqrtPriceX96).toBe(79228162514264337593543950336n); // 2^96
      expect(result.state.tick).toBe(0);
    });

    it('should create minimal pool price', async () => {
      // Arrange
      const mockDbResult = {
        ...MINIMAL_POOL_PRICE.dbResult,
        token1PricePerToken0: MINIMAL_POOL_PRICE.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: MINIMAL_POOL_PRICE.dbResult.token0PricePerToken1.toString(),
        config: MINIMAL_POOL_PRICE.dbResult.config,
        state: {
          sqrtPriceX96: MINIMAL_POOL_PRICE.dbResult.state.sqrtPriceX96.toString(),
          tick: MINIMAL_POOL_PRICE.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.create.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.create(MINIMAL_POOL_PRICE.input);

      // Assert
      expect(result.id).toBe(MINIMAL_POOL_PRICE.dbResult.id);
      expect(result.poolId).toBe('pool_minimal');
    });

    it('should serialize bigint values to strings in database', async () => {
      // Arrange
      prismaMock.poolPrice.create.mockResolvedValue({
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: '3793895265',
        token0PricePerToken1: '263592215453863',
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: '4880027310900678652549898',
          tick: -193909,
        },
      } as any);

      // Act
      await poolPriceService.create(WETH_USDC_POOL_PRICE_ARBITRUM.input);

      // Assert - Check that Prisma received string values
      expect(prismaMock.poolPrice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          token1PricePerToken0: '3793895265',
          token0PricePerToken1: '263592215453863',
          state: expect.objectContaining({
            sqrtPriceX96: '4880027310900678652549898',
          }),
        }),
      });
    });

    it('should propagate database errors', async () => {
      // Arrange
      const dbError = new Error('Database connection failed');
      prismaMock.poolPrice.create.mockRejectedValue(dbError);

      // Act & Assert
      await expect(
        poolPriceService.create(WETH_USDC_POOL_PRICE_ARBITRUM.input)
      ).rejects.toThrow('Database connection failed');
    });
  });

  // ==========================================================================
  // findById Method Tests
  // ==========================================================================

  describe('findById', () => {
    it('should find existing pool price by id', async () => {
      // Arrange
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.findUnique.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.findById('poolprice_weth_usdc_arb_001');

      // Assert
      expect(result).not.toBeNull();
      expect(result?.id).toBe('poolprice_weth_usdc_arb_001');
      expect(result?.protocol).toBe('uniswapv3');
      expect(result?.poolId).toBe('pool_weth_usdc_arb_001');
      expect(result?.token1PricePerToken0).toBe(3793_895265n);
      expect(result?.state.sqrtPriceX96).toBe(4880027310900678652549898n);
      expect(prismaMock.poolPrice.findUnique).toHaveBeenCalledWith({
        where: { id: 'poolprice_weth_usdc_arb_001' },
      });
    });

    it('should return null for non-existent id', async () => {
      // Arrange
      prismaMock.poolPrice.findUnique.mockResolvedValue(null);

      // Act
      const result = await poolPriceService.findById('non_existent_id');

      // Assert
      expect(result).toBeNull();
      expect(prismaMock.poolPrice.findUnique).toHaveBeenCalledWith({
        where: { id: 'non_existent_id' },
      });
    });

    it('should deserialize bigint values from database strings', async () => {
      // Arrange
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: '3793895265', // String in DB
        token0PricePerToken1: '263592215453863', // String in DB
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: '4880027310900678652549898', // String in DB
          tick: -193909,
        },
      };
      prismaMock.poolPrice.findUnique.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.findById('poolprice_weth_usdc_arb_001');

      // Assert - Should be bigint in application layer
      expect(typeof result?.token1PricePerToken0).toBe('bigint');
      expect(typeof result?.token0PricePerToken1).toBe('bigint');
      expect(typeof result?.state.sqrtPriceX96).toBe('bigint');
      expect(result?.token1PricePerToken0).toBe(3793_895265n);
    });

    it('should propagate database errors', async () => {
      // Arrange
      const dbError = new Error('Database query failed');
      prismaMock.poolPrice.findUnique.mockRejectedValue(dbError);

      // Act & Assert
      await expect(poolPriceService.findById('some_id')).rejects.toThrow(
        'Database query failed'
      );
    });
  });

  // ==========================================================================
  // findByPoolId Method Tests
  // ==========================================================================

  describe('findByPoolId', () => {
    it('should find all pool prices for a specific pool', async () => {
      // Arrange
      const mockDbResults = [
        {
          ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
          token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
          token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
          config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
          state: {
            sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
            tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
          },
        },
        {
          ...WETH_USDC_POOL_PRICE_EARLIER.dbResult,
          token1PricePerToken0: WETH_USDC_POOL_PRICE_EARLIER.dbResult.token1PricePerToken0.toString(),
          token0PricePerToken1: WETH_USDC_POOL_PRICE_EARLIER.dbResult.token0PricePerToken1.toString(),
          config: WETH_USDC_POOL_PRICE_EARLIER.dbResult.config,
          state: {
            sqrtPriceX96: WETH_USDC_POOL_PRICE_EARLIER.dbResult.state.sqrtPriceX96.toString(),
            tick: WETH_USDC_POOL_PRICE_EARLIER.dbResult.state.tick,
          },
        },
      ];
      prismaMock.poolPrice.findMany.mockResolvedValue(mockDbResults as any);

      // Act
      const results = await poolPriceService.findByPoolId('pool_weth_usdc_arb_001');

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].poolId).toBe('pool_weth_usdc_arb_001');
      expect(results[1].poolId).toBe('pool_weth_usdc_arb_001');
      expect(prismaMock.poolPrice.findMany).toHaveBeenCalledWith({
        where: { poolId: 'pool_weth_usdc_arb_001' },
        orderBy: { timestamp: 'desc' },
      });
    });

    it('should return empty array for pool with no prices', async () => {
      // Arrange
      prismaMock.poolPrice.findMany.mockResolvedValue([]);

      // Act
      const results = await poolPriceService.findByPoolId('pool_with_no_prices');

      // Assert
      expect(results).toHaveLength(0);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should order results by timestamp descending (newest first)', async () => {
      // Arrange
      prismaMock.poolPrice.findMany.mockResolvedValue([]);

      // Act
      await poolPriceService.findByPoolId('pool_test');

      // Assert
      expect(prismaMock.poolPrice.findMany).toHaveBeenCalledWith({
        where: { poolId: 'pool_test' },
        orderBy: { timestamp: 'desc' },
      });
    });
  });

  // ==========================================================================
  // findByPoolIdAndTimeRange Method Tests
  // ==========================================================================

  describe('findByPoolIdAndTimeRange', () => {
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-02-01T00:00:00Z');

    it('should find pool prices within time range', async () => {
      // Arrange
      const mockDbResults = [
        {
          ...WETH_USDC_POOL_PRICE_EARLIER.dbResult,
          token1PricePerToken0: WETH_USDC_POOL_PRICE_EARLIER.dbResult.token1PricePerToken0.toString(),
          token0PricePerToken1: WETH_USDC_POOL_PRICE_EARLIER.dbResult.token0PricePerToken1.toString(),
          config: WETH_USDC_POOL_PRICE_EARLIER.dbResult.config,
          state: {
            sqrtPriceX96: WETH_USDC_POOL_PRICE_EARLIER.dbResult.state.sqrtPriceX96.toString(),
            tick: WETH_USDC_POOL_PRICE_EARLIER.dbResult.state.tick,
          },
        },
        {
          ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
          token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
          token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
          config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
          state: {
            sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
            tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
          },
        },
      ];
      prismaMock.poolPrice.findMany.mockResolvedValue(mockDbResults as any);

      // Act
      const results = await poolPriceService.findByPoolIdAndTimeRange(
        'pool_weth_usdc_arb_001',
        startTime,
        endTime
      );

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].timestamp.getTime()).toBe(WETH_USDC_POOL_PRICE_EARLIER.dbResult.timestamp.getTime());
      expect(results[1].timestamp.getTime()).toBe(WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.timestamp.getTime());
      expect(prismaMock.poolPrice.findMany).toHaveBeenCalledWith({
        where: {
          poolId: 'pool_weth_usdc_arb_001',
          timestamp: {
            gte: startTime,
            lte: endTime,
          },
        },
        orderBy: { timestamp: 'asc' },
      });
    });

    it('should return empty array for time range with no prices', async () => {
      // Arrange
      prismaMock.poolPrice.findMany.mockResolvedValue([]);

      // Act
      const results = await poolPriceService.findByPoolIdAndTimeRange(
        'pool_test',
        startTime,
        endTime
      );

      // Assert
      expect(results).toHaveLength(0);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should order results by timestamp ascending (oldest first)', async () => {
      // Arrange
      prismaMock.poolPrice.findMany.mockResolvedValue([]);

      // Act
      await poolPriceService.findByPoolIdAndTimeRange('pool_test', startTime, endTime);

      // Assert
      expect(prismaMock.poolPrice.findMany).toHaveBeenCalledWith({
        where: {
          poolId: 'pool_test',
          timestamp: {
            gte: startTime,
            lte: endTime,
          },
        },
        orderBy: { timestamp: 'asc' },
      });
    });

    it('should handle single-day time range', async () => {
      // Arrange
      const singleDay = new Date('2024-01-15T00:00:00Z');
      const endOfDay = new Date('2024-01-15T23:59:59Z');
      prismaMock.poolPrice.findMany.mockResolvedValue([]);

      // Act
      await poolPriceService.findByPoolIdAndTimeRange('pool_test', singleDay, endOfDay);

      // Assert
      expect(prismaMock.poolPrice.findMany).toHaveBeenCalledWith({
        where: {
          poolId: 'pool_test',
          timestamp: {
            gte: singleDay,
            lte: endOfDay,
          },
        },
        orderBy: { timestamp: 'asc' },
      });
    });
  });

  // ==========================================================================
  // update Method Tests
  // ==========================================================================

  describe('update', () => {
    it('should update pool price timestamp', async () => {
      // Arrange
      const newTimestamp = new Date('2024-03-01T00:00:00Z');
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        timestamp: newTimestamp,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.update.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.update('poolprice_weth_usdc_arb_001', {
        timestamp: newTimestamp,
      });

      // Assert
      expect(result.timestamp).toEqual(newTimestamp);
      expect(prismaMock.poolPrice.update).toHaveBeenCalledWith({
        where: { id: 'poolprice_weth_usdc_arb_001' },
        data: { timestamp: newTimestamp },
      });
    });

    it('should update pool price prices', async () => {
      // Arrange
      const newPrice0in1 = 4000_000000n;
      const newPrice1in0 = 250000000000000n;
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: newPrice0in1.toString(),
        token0PricePerToken1: newPrice1in0.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.update.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.update('poolprice_weth_usdc_arb_001', {
        token1PricePerToken0: newPrice0in1,
        token0PricePerToken1: newPrice1in0,
      });

      // Assert
      expect(result.token1PricePerToken0).toBe(newPrice0in1);
      expect(result.token0PricePerToken1).toBe(newPrice1in0);
    });

    it('should update pool price state', async () => {
      // Arrange
      const newState: UniswapV3PoolPriceState = {
        sqrtPriceX96: 5000000000000000000000000n,
        tick: -192000,
      };
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: newState.sqrtPriceX96.toString(),
          tick: newState.tick,
        },
      };
      prismaMock.poolPrice.update.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.update('poolprice_weth_usdc_arb_001', {
        state: newState,
      });

      // Assert
      expect(result.state.sqrtPriceX96).toBe(newState.sqrtPriceX96);
      expect(result.state.tick).toBe(newState.tick);
    });

    it('should update pool price config', async () => {
      // Arrange
      const newConfig: UniswapV3PoolPriceConfig = {
        blockNumber: 19000000,
        blockTimestamp: 1709251200,
      };
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: newConfig,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.update.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.update('poolprice_weth_usdc_arb_001', {
        config: newConfig,
      });

      // Assert
      expect(result.config.blockNumber).toBe(19000000);
      expect(result.config.blockTimestamp).toBe(1709251200);
    });

    it('should handle empty update input', async () => {
      // Arrange
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.update.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await poolPriceService.update('poolprice_weth_usdc_arb_001', {});

      // Assert
      expect(result).toBeDefined();
      expect(prismaMock.poolPrice.update).toHaveBeenCalledWith({
        where: { id: 'poolprice_weth_usdc_arb_001' },
        data: {},
      });
    });

    it('should propagate not found errors', async () => {
      // Arrange
      const notFoundError = new Error('Record not found');
      (notFoundError as any).code = 'P2025';
      prismaMock.poolPrice.update.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(
        poolPriceService.update('non_existent_id', { timestamp: new Date() })
      ).rejects.toThrow('Record not found');
    });
  });

  // ==========================================================================
  // delete Method Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete existing pool price', async () => {
      // Arrange
      prismaMock.poolPrice.delete.mockResolvedValue(
        WETH_USDC_POOL_PRICE_ARBITRUM.dbResult as any
      );

      // Act
      await poolPriceService.delete('poolprice_weth_usdc_arb_001');

      // Assert
      expect(prismaMock.poolPrice.delete).toHaveBeenCalledWith({
        where: { id: 'poolprice_weth_usdc_arb_001' },
      });
    });

    it('should silently succeed for non-existent pool price', async () => {
      // Arrange
      const notFoundError = new Error('Record not found');
      (notFoundError as any).code = 'P2025';
      prismaMock.poolPrice.delete.mockRejectedValue(notFoundError);

      // Act & Assert - Should not throw
      await expect(
        poolPriceService.delete('non_existent_id')
      ).resolves.toBeUndefined();
    });

    it('should propagate other database errors', async () => {
      // Arrange
      const dbError = new Error('Database connection lost');
      prismaMock.poolPrice.delete.mockRejectedValue(dbError);

      // Act & Assert
      await expect(poolPriceService.delete('some_id')).rejects.toThrow(
        'Database connection lost'
      );
    });
  });
});
