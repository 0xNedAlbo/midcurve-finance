/**
 * Comprehensive tests for UniswapV3PoolPriceService
 * Tests Uniswap V3-specific implementation including discovery
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { UniswapV3PoolPriceService } from './uniswapv3-pool-price-service.js';
import { EvmConfig } from '../../config/evm.js';
import type { PublicClient } from 'viem';
import {
  WETH_USDC_POOL_PRICE_ARBITRUM,
  WBTC_USDC_POOL_PRICE_ARBITRUM,
  USDC_USDT_POOL_PRICE,
  createPoolPriceFixture,
} from './test-fixtures.js';
import type {
  UniswapV3PoolPriceConfig,
  UniswapV3PoolPriceState,
} from '@midcurve/shared';
import type {
  UniswapV3PoolPriceConfigDB,
  UniswapV3PoolPriceStateDB,
} from '../types/pool-price/uniswapv3/pool-price-db.js';

describe('UniswapV3PoolPriceService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let evmConfigMock: DeepMockProxy<EvmConfig>;
  let publicClientMock: DeepMockProxy<PublicClient>;
  let service: UniswapV3PoolPriceService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    evmConfigMock = mockDeep<EvmConfig>();
    publicClientMock = mockDeep<PublicClient>();
    service = new UniswapV3PoolPriceService({
      prisma: prismaMock as unknown as PrismaClient,
      evmConfig: evmConfigMock as unknown as EvmConfig,
    });
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with provided dependencies', () => {
      const instance = new UniswapV3PoolPriceService({
        prisma: prismaMock as unknown as PrismaClient,
        evmConfig: evmConfigMock as unknown as EvmConfig,
      });
      expect(instance).toBeInstanceOf(UniswapV3PoolPriceService);
    });

    it('should create instance with default dependencies', () => {
      const instance = new UniswapV3PoolPriceService();
      expect(instance).toBeInstanceOf(UniswapV3PoolPriceService);
    });
  });

  // ==========================================================================
  // Serialization Tests
  // ==========================================================================

  describe('parseConfig', () => {
    it('should parse config from database format', () => {
      // Arrange
      const configDB: UniswapV3PoolPriceConfigDB = {
        blockNumber: 18000000,
        blockTimestamp: 1705315800,
      };

      // Act
      const result = service.parseConfig(configDB);

      // Assert
      expect(result).toEqual({
        blockNumber: 18000000,
        blockTimestamp: 1705315800,
      });
    });

    it('should handle config with all fields', () => {
      // Arrange
      const configDB: UniswapV3PoolPriceConfigDB = {
        blockNumber: 19000000,
        blockTimestamp: 1709251200,
      };

      // Act
      const result = service.parseConfig(configDB);

      // Assert
      expect(result.blockNumber).toBe(19000000);
      expect(result.blockTimestamp).toBe(1709251200);
    });
  });

  describe('serializeConfig', () => {
    it('should serialize config to database format', () => {
      // Arrange
      const config: UniswapV3PoolPriceConfig = {
        blockNumber: 18000000,
        blockTimestamp: 1705315800,
      };

      // Act
      const result = service.serializeConfig(config);

      // Assert
      expect(result).toEqual({
        blockNumber: 18000000,
        blockTimestamp: 1705315800,
      });
    });
  });

  describe('parseState', () => {
    it('should parse state from database format (string to bigint)', () => {
      // Arrange
      const stateDB: UniswapV3PoolPriceStateDB = {
        sqrtPriceX96: '4880027310900678652549898',
        tick: -193909,
      };

      // Act
      const result = service.parseState(stateDB);

      // Assert
      expect(result).toEqual({
        sqrtPriceX96: 4880027310900678652549898n,
        tick: -193909,
      });
      expect(typeof result.sqrtPriceX96).toBe('bigint');
    });

    it('should handle large sqrtPriceX96 values', () => {
      // Arrange
      const stateDB: UniswapV3PoolPriceStateDB = {
        sqrtPriceX96: '2594590524261178691684425401086',
        tick: 69780,
      };

      // Act
      const result = service.parseState(stateDB);

      // Assert
      expect(result.sqrtPriceX96).toBe(2594590524261178691684425401086n);
      expect(result.tick).toBe(69780);
    });

    it('should handle negative ticks', () => {
      // Arrange
      const stateDB: UniswapV3PoolPriceStateDB = {
        sqrtPriceX96: '3703786271042312924479525',
        tick: -198710,
      };

      // Act
      const result = service.parseState(stateDB);

      // Assert
      expect(result.tick).toBe(-198710);
    });
  });

  describe('serializeState', () => {
    it('should serialize state to database format (bigint to string)', () => {
      // Arrange
      const state: UniswapV3PoolPriceState = {
        sqrtPriceX96: 4880027310900678652549898n,
        tick: -193909,
      };

      // Act
      const result = service.serializeState(state) as UniswapV3PoolPriceStateDB;

      // Assert
      expect(result).toEqual({
        sqrtPriceX96: '4880027310900678652549898',
        tick: -193909,
      });
      expect(typeof result.sqrtPriceX96).toBe('string');
    });

    it('should handle large bigint values', () => {
      // Arrange
      const state: UniswapV3PoolPriceState = {
        sqrtPriceX96: 2594590524261178691684425401086n,
        tick: 69780,
      };

      // Act
      const result = service.serializeState(state) as UniswapV3PoolPriceStateDB;

      // Assert
      expect(result.sqrtPriceX96).toBe('2594590524261178691684425401086');
    });
  });

  describe('serialization round-trip', () => {
    it('should maintain data integrity through serialize/parse cycle', () => {
      // Arrange
      const originalState: UniswapV3PoolPriceState = {
        sqrtPriceX96: 4880027310900678652549898n,
        tick: -193909,
      };

      // Act
      const serialized = service.serializeState(originalState);
      const parsed = service.parseState(serialized);

      // Assert
      expect(parsed).toEqual(originalState);
    });

    it('should handle config round-trip', () => {
      // Arrange
      const originalConfig: UniswapV3PoolPriceConfig = {
        blockNumber: 18000000,
        blockTimestamp: 1705315800,
      };

      // Act
      const serialized = service.serializeConfig(originalConfig);
      const parsed = service.parseConfig(serialized);

      // Assert
      expect(parsed).toEqual(originalConfig);
    });
  });

  // ==========================================================================
  // create Method Tests (with protocol validation)
  // ==========================================================================

  describe('create', () => {
    it('should create pool price with uniswapv3 protocol', async () => {
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
      prismaMock.poolPrice.create.mockResolvedValue(mockDbResult as any);

      // Act
      const result = await service.create(WETH_USDC_POOL_PRICE_ARBITRUM.input);

      // Assert
      expect(result.protocol).toBe('uniswapv3');
      expect(result.id).toBe(WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.id);
    });

    it('should reject non-uniswapv3 protocol', async () => {
      // Arrange
      const invalidInput = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.input,
        protocol: 'orca' as any,
      };

      // Act & Assert
      await expect(service.create(invalidInput)).rejects.toThrow(
        "Invalid protocol 'orca' for UniswapV3PoolPriceService. Expected 'uniswapv3'."
      );
      expect(prismaMock.poolPrice.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // findById Method Tests (with protocol validation)
  // ==========================================================================

  describe('findById', () => {
    it('should find uniswapv3 pool price by id', async () => {
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
      const result = await service.findById('poolprice_weth_usdc_arb_001');

      // Assert
      expect(result).not.toBeNull();
      expect(result?.protocol).toBe('uniswapv3');
      expect(result?.id).toBe('poolprice_weth_usdc_arb_001');
    });

    it('should return null for non-uniswapv3 protocol', async () => {
      // Arrange
      const mockDbResult = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        protocol: 'orca', // Wrong protocol
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
      const result = await service.findById('poolprice_orca_001');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent id', async () => {
      // Arrange
      prismaMock.poolPrice.findUnique.mockResolvedValue(null);

      // Act
      const result = await service.findById('non_existent_id');

      // Assert
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // findByPoolId Method Tests (with protocol filtering)
  // ==========================================================================

  describe('findByPoolId', () => {
    it('should find all uniswapv3 pool prices for a pool', async () => {
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
      ];
      prismaMock.poolPrice.findMany.mockResolvedValue(mockDbResults as any);

      // Act
      const results = await service.findByPoolId('pool_weth_usdc_arb_001');

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].protocol).toBe('uniswapv3');
    });

    it('should filter out non-uniswapv3 protocols', async () => {
      // Arrange
      const mockDbResults = [
        {
          ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
          protocol: 'uniswapv3',
          token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
          token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
          config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
          state: {
            sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
            tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
          },
        },
        {
          ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
          protocol: 'orca', // Different protocol
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
      const results = await service.findByPoolId('pool_test');

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].protocol).toBe('uniswapv3');
    });
  });

  // ==========================================================================
  // findByPoolIdAndTimeRange Method Tests (with protocol filtering)
  // ==========================================================================

  describe('findByPoolIdAndTimeRange', () => {
    it('should find uniswapv3 pool prices within time range', async () => {
      // Arrange
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-02-01T00:00:00Z');
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
      ];
      prismaMock.poolPrice.findMany.mockResolvedValue(mockDbResults as any);

      // Act
      const results = await service.findByPoolIdAndTimeRange(
        'pool_weth_usdc_arb_001',
        startTime,
        endTime
      );

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].protocol).toBe('uniswapv3');
    });

    it('should filter out non-uniswapv3 protocols in time range', async () => {
      // Arrange
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-02-01T00:00:00Z');
      const mockDbResults = [
        {
          ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
          protocol: 'uniswapv3',
          token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
          token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
          config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
          state: {
            sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
            tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
          },
        },
        {
          ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
          protocol: 'orca',
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
      const results = await service.findByPoolIdAndTimeRange('pool_test', startTime, endTime);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].protocol).toBe('uniswapv3');
    });
  });

  // ==========================================================================
  // delete Method Tests (with protocol validation)
  // ==========================================================================

  describe('delete', () => {
    it('should delete uniswapv3 pool price', async () => {
      // Arrange
      const mockPoolPrice = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.findUnique.mockResolvedValue(mockPoolPrice as any);
      prismaMock.poolPrice.delete.mockResolvedValue(mockPoolPrice as any);

      // Act
      await service.delete('poolprice_weth_usdc_arb_001');

      // Assert
      expect(prismaMock.poolPrice.delete).toHaveBeenCalledWith({
        where: { id: 'poolprice_weth_usdc_arb_001' },
      });
    });

    it('should reject deletion of non-uniswapv3 protocol', async () => {
      // Arrange
      const mockPoolPrice = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        protocol: 'orca',
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.config,
        state: {
          sqrtPriceX96: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.sqrtPriceX96.toString(),
          tick: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.state.tick,
        },
      };
      prismaMock.poolPrice.findUnique.mockResolvedValue(mockPoolPrice as any);

      // Act & Assert
      await expect(service.delete('poolprice_orca_001')).rejects.toThrow(
        "Cannot delete pool price with protocol 'orca' using UniswapV3PoolPriceService"
      );
      expect(prismaMock.poolPrice.delete).not.toHaveBeenCalled();
    });

    it('should silently succeed for non-existent pool price', async () => {
      // Arrange
      prismaMock.poolPrice.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.delete('non_existent_id')).resolves.toBeUndefined();
      expect(prismaMock.poolPrice.delete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // discover Method Tests
  // ==========================================================================

  describe('discover', () => {
    const poolId = 'pool_weth_usdc_arb_001';
    const blockNumber = 18000000;
    const blockTimestamp = 1705315800;
    const poolAddress = '0xC6962004f452bE9203591991D15f6b388e09E8D0';
    const chainId = 42161; // Arbitrum

    const mockPool = {
      id: poolId,
      protocol: 'uniswapv3',
      poolType: 'CL_TICKS',
      token0Id: 'token_weth',
      token1Id: 'token_usdc',
      feeBps: 5,
      config: {
        address: poolAddress,
        chainId,
        feeTier: 500,
      },
      state: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      token0: {
        id: 'token_weth',
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      token1: {
        id: 'token_usdc',
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const mockBlock = {
      number: BigInt(blockNumber),
      timestamp: BigInt(blockTimestamp),
      hash: '0x123...',
    };

    const mockSlot0 = [
      4880027310900678652549898n, // sqrtPriceX96
      -193909, // tick
      0, // observationIndex
      0, // observationCardinality
      0, // observationCardinalityNext
      0, // feeProtocol
      false, // unlocked
    ] as const;

    it('should discover pool price from on-chain data', async () => {
      // Arrange
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);
      prismaMock.poolPrice.findFirst.mockResolvedValue(null); // No existing price
      evmConfigMock.isChainSupported.mockReturnValue(true);
      evmConfigMock.getPublicClient.mockReturnValue(publicClientMock as any);
      publicClientMock.getBlock.mockResolvedValue(mockBlock as any);
      publicClientMock.readContract.mockResolvedValue(mockSlot0 as any);

      const mockCreatedPrice = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: { blockNumber, blockTimestamp },
        state: {
          sqrtPriceX96: mockSlot0[0].toString(),
          tick: mockSlot0[1],
        },
      };
      prismaMock.poolPrice.create.mockResolvedValue(mockCreatedPrice as any);

      // Act
      const result = await service.discover(poolId, { blockNumber });

      // Assert
      expect(result.poolId).toBe(poolId);
      expect(result.protocol).toBe('uniswapv3');
      expect(result.config.blockNumber).toBe(blockNumber);
      expect(result.state.sqrtPriceX96).toBe(mockSlot0[0]);
      expect(result.state.tick).toBe(mockSlot0[1]);
      expect(prismaMock.pool.findUnique).toHaveBeenCalledWith({
        where: { id: poolId },
        include: { token0: true, token1: true },
      });
      expect(publicClientMock.getBlock).toHaveBeenCalledWith({
        blockNumber: BigInt(blockNumber),
      });
      expect(publicClientMock.readContract).toHaveBeenCalled();
    });

    it('should return existing price if already discovered (idempotent)', async () => {
      // Arrange
      const existingPrice = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: { blockNumber, blockTimestamp },
        state: {
          sqrtPriceX96: mockSlot0[0].toString(),
          tick: mockSlot0[1],
        },
      };
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);
      prismaMock.poolPrice.findFirst.mockResolvedValue(existingPrice as any);

      // Act
      const result = await service.discover(poolId, { blockNumber });

      // Assert
      expect(result.id).toBe(existingPrice.id);
      expect(result.poolId).toBe(poolId);
      expect(evmConfigMock.getPublicClient).not.toHaveBeenCalled();
      expect(publicClientMock.getBlock).not.toHaveBeenCalled();
      expect(publicClientMock.readContract).not.toHaveBeenCalled();
      expect(prismaMock.poolPrice.create).not.toHaveBeenCalled();
    });

    it('should throw error if pool not found', async () => {
      // Arrange
      prismaMock.pool.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.discover(poolId, { blockNumber })).rejects.toThrow(
        `Pool not found: ${poolId}`
      );
    });

    it('should throw error if pool protocol is not uniswapv3', async () => {
      // Arrange
      const invalidPool = { ...mockPool, protocol: 'orca' };
      prismaMock.pool.findUnique.mockResolvedValue(invalidPool as any);

      // Act & Assert
      await expect(service.discover(poolId, { blockNumber })).rejects.toThrow(
        "Invalid pool protocol 'orca'. Expected 'uniswapv3'."
      );
    });

    it('should throw error if chain is not supported', async () => {
      // Arrange
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);
      prismaMock.poolPrice.findFirst.mockResolvedValue(null);
      evmConfigMock.isChainSupported.mockReturnValue(false);
      evmConfigMock.getChainConfig.mockReturnValue({
        chainId: 42161,
        name: 'Arbitrum',
        rpcUrl: '',
        blockExplorer: '',
        viemChain: null as any,
      });

      // Act & Assert
      await expect(service.discover(poolId, { blockNumber })).rejects.toThrow(
        'Chain 42161 is not supported'
      );
    });

    it('should propagate RPC errors', async () => {
      // Arrange
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);
      prismaMock.poolPrice.findFirst.mockResolvedValue(null);
      evmConfigMock.isChainSupported.mockReturnValue(true);
      evmConfigMock.getPublicClient.mockReturnValue(publicClientMock as any);
      const rpcError = new Error('RPC call failed');
      publicClientMock.getBlock.mockRejectedValue(rpcError);

      // Act & Assert
      await expect(service.discover(poolId, { blockNumber })).rejects.toThrow(
        'RPC call failed'
      );
    });

    it('should handle different block numbers for same pool', async () => {
      // Arrange
      const blockNumber2 = 18500000;
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);
      prismaMock.poolPrice.findFirst.mockResolvedValue(null);
      evmConfigMock.isChainSupported.mockReturnValue(true);
      evmConfigMock.getPublicClient.mockReturnValue(publicClientMock as any);
      publicClientMock.getBlock.mockResolvedValue({
        ...mockBlock,
        number: BigInt(blockNumber2),
      } as any);
      publicClientMock.readContract.mockResolvedValue(mockSlot0 as any);

      const mockCreatedPrice = {
        ...WETH_USDC_POOL_PRICE_ARBITRUM.dbResult,
        id: 'poolprice_new',
        token1PricePerToken0: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token1PricePerToken0.toString(),
        token0PricePerToken1: WETH_USDC_POOL_PRICE_ARBITRUM.dbResult.token0PricePerToken1.toString(),
        config: { blockNumber: blockNumber2, blockTimestamp },
        state: {
          sqrtPriceX96: mockSlot0[0].toString(),
          tick: mockSlot0[1],
        },
      };
      prismaMock.poolPrice.create.mockResolvedValue(mockCreatedPrice as any);

      // Act
      const result = await service.discover(poolId, { blockNumber: blockNumber2 });

      // Assert
      expect(result.config.blockNumber).toBe(blockNumber2);
      expect(prismaMock.poolPrice.create).toHaveBeenCalled();
    });
  });
});
