/**
 * Tests for UniswapV3PoolService
 * Comprehensive test suite covering all CRUD operations, discovery, and state management
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import type { PublicClient } from 'viem';
import { UniswapV3PoolService } from './uniswapv3-pool-service.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { EvmConfig } from '../../config/evm.js';
import { PoolConfigError, PoolStateError } from '../../utils/uniswapv3/index.js';
import {
  USDC_TOKEN,
  WETH_TOKEN,
  DAI_TOKEN,
  USDC_WETH_POOL,
  USDC_DAI_POOL,
  USDC_WETH_CONFIG,
  ACTIVE_POOL_STATE,
  ZERO_POOL_STATE,
  createPoolFixture,
} from './test-fixtures.js';

describe('UniswapV3PoolService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let evmConfigMock: DeepMockProxy<EvmConfig>;
  let erc20TokenServiceMock: DeepMockProxy<Erc20TokenService>;
  let publicClientMock: DeepMockProxy<PublicClient>;
  let service: UniswapV3PoolService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    evmConfigMock = mockDeep<EvmConfig>();
    erc20TokenServiceMock = mockDeep<Erc20TokenService>();
    publicClientMock = mockDeep<PublicClient>();

    service = new UniswapV3PoolService({
      prisma: prismaMock as unknown as PrismaClient,
      evmConfig: evmConfigMock as unknown as EvmConfig,
      erc20TokenService: erc20TokenServiceMock as unknown as Erc20TokenService,
    });
  });

  // ==========================================================================
  // Serialization Tests
  // ==========================================================================

  describe('parseConfig', () => {
    it('should parse valid config from database', () => {
      const configDB = {
        chainId: 1,
        address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        feeBps: 500,
        tickSpacing: 10,
      };

      const result = service.parseConfig(configDB);

      expect(result.chainId).toBe(1);
      expect(result.address).toBe('0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640');
      expect(result.token0).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(result.token1).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(result.feeBps).toBe(500);
      expect(result.tickSpacing).toBe(10);
    });
  });

  describe('serializeConfig', () => {
    it('should serialize config to database format', () => {
      const result = service.serializeConfig(USDC_WETH_CONFIG);

      expect(result).toEqual({
        chainId: 1,
        address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        feeBps: 500,
        tickSpacing: 10,
      });
    });
  });

  describe('parseState', () => {
    it('should parse state with bigint conversion', () => {
      const stateDB = {
        sqrtPriceX96: '1234567890123456789012345678',
        currentTick: 201234,
        liquidity: '9876543210987654321098765',
        feeGrowthGlobal0: '111111111111111111111',
        feeGrowthGlobal1: '222222222222222222222',
      };

      const result = service.parseState(stateDB);

      expect(result.sqrtPriceX96).toBe(1234567890123456789012345678n);
      expect(result.currentTick).toBe(201234);
      expect(result.liquidity).toBe(9876543210987654321098765n);
      expect(result.feeGrowthGlobal0).toBe(111111111111111111111n);
      expect(result.feeGrowthGlobal1).toBe(222222222222222222222n);
    });

    it('should handle zero values', () => {
      const stateDB = {
        sqrtPriceX96: '0',
        currentTick: 0,
        liquidity: '0',
        feeGrowthGlobal0: '0',
        feeGrowthGlobal1: '0',
      };

      const result = service.parseState(stateDB);

      expect(result.sqrtPriceX96).toBe(0n);
      expect(result.currentTick).toBe(0);
      expect(result.liquidity).toBe(0n);
      expect(result.feeGrowthGlobal0).toBe(0n);
      expect(result.feeGrowthGlobal1).toBe(0n);
    });
  });

  describe('serializeState', () => {
    it('should serialize state with bigint to string conversion', () => {
      const result = service.serializeState(ACTIVE_POOL_STATE);

      expect(result).toEqual({
        sqrtPriceX96: '1234567890123456789012345678',
        currentTick: 201234,
        liquidity: '9876543210987654321098765',
        feeGrowthGlobal0: '111111111111111111111',
        feeGrowthGlobal1: '222222222222222222222',
      });
    });

    it('should handle zero bigint values', () => {
      const result = service.serializeState(ZERO_POOL_STATE);

      expect(result).toEqual({
        sqrtPriceX96: '0',
        currentTick: 0,
        liquidity: '0',
        feeGrowthGlobal0: '0',
        feeGrowthGlobal1: '0',
      });
    });
  });

  // ==========================================================================
  // discover() Tests
  // ==========================================================================

  describe('discover', () => {
    describe('successful discovery', () => {
      it('should discover new pool from on-chain data', async () => {
        const { dbResult, pool } = USDC_WETH_POOL;

        // Mock: Pool doesn't exist on first check in discover()
        prismaMock.pool.findFirst.mockResolvedValueOnce(null);

        // Mock: Chain is supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Read pool config from on-chain
        publicClientMock.multicall.mockResolvedValueOnce([
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // token0
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // token1
          500, // fee
          10, // tickSpacing
        ] as any);

        // Mock: Discover tokens
        erc20TokenServiceMock.discover
          .mockResolvedValueOnce(USDC_TOKEN)
          .mockResolvedValueOnce(WETH_TOKEN);

        // Mock: Read pool state
        publicClientMock.multicall.mockResolvedValueOnce([
          [1234567890123456789012345678n, 201234], // slot0
          9876543210987654321098765n, // liquidity
          111111111111111111111n, // feeGrowthGlobal0
          222222222222222222222n, // feeGrowthGlobal1
        ] as any);

        // Mock: Create pool
        prismaMock.pool.create.mockResolvedValue(dbResult);

        // Mock: Find pool by address (called by create override to refetch after creation)
        prismaMock.pool.findFirst.mockResolvedValueOnce(dbResult);

        // Execute
        const result = await service.discover({
          poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
          chainId: 1,
        });

        // Verify
        expect(result.id).toBe(pool.id);
        expect(result.protocol).toBe('uniswapv3');
        expect(result.token0.symbol).toBe('USDC');
        expect(result.token1.symbol).toBe('WETH');
        expect(result.config.address).toBe('0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640');
        expect(result.state.sqrtPriceX96).toBe(1234567890123456789012345678n);
      });

      it('should return existing pool and refresh state (idempotent)', async () => {
        const { dbResult, pool } = USDC_WETH_POOL;

        // Mock: Pool already exists (first call to findFirst in discover)
        prismaMock.pool.findFirst.mockResolvedValueOnce(dbResult);

        // Mock: Chain is supported (for refresh)
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Read fresh pool state from on-chain (in refresh)
        publicClientMock.multicall.mockResolvedValueOnce([
          [1234567890123456789012345678n, 201234], // slot0 (same as fixture)
          9876543210987654321098765n, // liquidity (same as fixture)
          111111111111111111111n, // feeGrowthGlobal0
          222222222222222222222n, // feeGrowthGlobal1
        ] as any);

        // Mock: Update pool (in refresh)
        prismaMock.pool.update.mockResolvedValue(dbResult);

        // Mock: Re-fetch pool after update (in refresh, then in update override)
        prismaMock.pool.findUnique.mockResolvedValue(dbResult);
        prismaMock.pool.findFirst.mockResolvedValue(dbResult);

        // Execute
        const result = await service.discover({
          poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
          chainId: 1,
        });

        // Verify
        expect(result.id).toBe(pool.id);
        expect(result.protocol).toBe('uniswapv3');

        // Verify refresh was called (on-chain state was read)
        expect(publicClientMock.multicall).toHaveBeenCalled();

        // Verify pool was updated with fresh state
        expect(prismaMock.pool.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: pool.id },
            data: expect.objectContaining({
              state: expect.any(Object),
            }),
          })
        );

        // Verify token discovery was NOT called (pool already had tokens)
        expect(erc20TokenServiceMock.discover).not.toHaveBeenCalled();

        // Verify pool was NOT created (it already existed)
        expect(prismaMock.pool.create).not.toHaveBeenCalled();
      });

      it('should refresh existing pool with fresh on-chain state', async () => {
        const { pool } = USDC_WETH_POOL;

        // Create DB result with OLD state (different from what on-chain will return)
        const dbResultWithOldState = {
          id: pool.id,
          createdAt: pool.createdAt,
          updatedAt: pool.updatedAt,
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: pool.token0.id,
          token1Id: pool.token1.id,
          feeBps: 500,
          config: {
            chainId: 1,
            address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
            token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            feeBps: 500,
            tickSpacing: 10,
          },
          state: {
            sqrtPriceX96: '1000000000000000000000000000', // OLD price
            currentTick: 100000, // OLD tick
            liquidity: '5000000000000000000000000', // OLD liquidity
            feeGrowthGlobal0: '100000000000000000000',
            feeGrowthGlobal1: '200000000000000000000',
          },
          token0: {
            id: pool.token0.id,
            createdAt: pool.token0.createdAt,
            updatedAt: pool.token0.updatedAt,
            tokenType: 'erc20',
            name: pool.token0.name,
            symbol: pool.token0.symbol,
            decimals: pool.token0.decimals,
            logoUrl: pool.token0.logoUrl,
            coingeckoId: pool.token0.coingeckoId,
            marketCap: pool.token0.marketCap,
            config: pool.token0.config,
          },
          token1: {
            id: pool.token1.id,
            createdAt: pool.token1.createdAt,
            updatedAt: pool.token1.updatedAt,
            tokenType: 'erc20',
            name: pool.token1.name,
            symbol: pool.token1.symbol,
            decimals: pool.token1.decimals,
            logoUrl: pool.token1.logoUrl,
            coingeckoId: pool.token1.coingeckoId,
            marketCap: pool.token1.marketCap,
            config: pool.token1.config,
          },
        };

        // Create updated DB result with FRESH state (what will be returned after update)
        const dbResultWithFreshState = {
          ...dbResultWithOldState,
          state: {
            sqrtPriceX96: '2000000000000000000000000000', // NEW price
            currentTick: 202000, // NEW tick
            liquidity: '10000000000000000000000000', // NEW liquidity
            feeGrowthGlobal0: '150000000000000000000',
            feeGrowthGlobal1: '250000000000000000000',
          },
        };

        // Mock: Pool exists with OLD state
        prismaMock.pool.findFirst.mockResolvedValueOnce(dbResultWithOldState as any);

        // Mock: Chain is supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Read FRESH state from on-chain (different values)
        publicClientMock.multicall.mockResolvedValueOnce([
          [2000000000000000000000000000n, 202000], // slot0 (NEW values)
          10000000000000000000000000n, // liquidity (NEW value)
          150000000000000000000n, // feeGrowthGlobal0
          250000000000000000000n, // feeGrowthGlobal1
        ] as any);

        // Mock: Update pool with fresh state
        prismaMock.pool.update.mockResolvedValue(dbResultWithFreshState as any);

        // Mock: Re-fetch pool after update returns FRESH state
        prismaMock.pool.findUnique.mockResolvedValue(dbResultWithFreshState as any);
        prismaMock.pool.findFirst.mockResolvedValue(dbResultWithFreshState as any);

        // Execute
        const result = await service.discover({
          poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
          chainId: 1,
        });

        // Verify result has FRESH state (not old state)
        expect(result.state.sqrtPriceX96).toBe(2000000000000000000000000000n);
        expect(result.state.currentTick).toBe(202000);
        expect(result.state.liquidity).toBe(10000000000000000000000000n);

        // Verify refresh was called (on-chain read + update)
        expect(publicClientMock.multicall).toHaveBeenCalled();
        expect(prismaMock.pool.update).toHaveBeenCalled();
      });

      it('should normalize address before lookup', async () => {
        const { dbResult } = USDC_WETH_POOL;

        // Mock: Pool exists
        prismaMock.pool.findFirst.mockResolvedValueOnce(dbResult);

        // Mock refresh behavior (required since discover now calls refresh)
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );
        publicClientMock.multicall.mockResolvedValueOnce([
          [1234567890123456789012345678n, 201234],
          9876543210987654321098765n,
          111111111111111111111n,
          222222222222222222222n,
        ] as any);
        prismaMock.pool.update.mockResolvedValue(dbResult);
        prismaMock.pool.findUnique.mockResolvedValue(dbResult);
        prismaMock.pool.findFirst.mockResolvedValue(dbResult);

        // Execute with lowercase address
        await service.discover({
          poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', // lowercase
          chainId: 1,
        });

        // Verify address was normalized (check first call to findFirst)
        expect(prismaMock.pool.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              config: expect.objectContaining({
                path: ['address'],
                equals: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // checksummed
              }),
            }),
          })
        );
      });
    });

    describe('validation errors', () => {
      it('should throw error for invalid pool address', async () => {
        await expect(
          service.discover({
            poolAddress: 'invalid',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid pool address format');
      });

      it('should throw error for too short address', async () => {
        await expect(
          service.discover({
            poolAddress: '0x123',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid pool address format');
      });

      it('should throw error for address without 0x prefix', async () => {
        await expect(
          service.discover({
            poolAddress: '88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid pool address format');
      });

      it('should throw error for unsupported chain', async () => {
        // Mock: Pool doesn't exist
        prismaMock.pool.findFirst.mockResolvedValue(null);

        // Mock: Chain is not supported
        evmConfigMock.isChainSupported.mockReturnValue(false);
        evmConfigMock.getSupportedChainIds.mockReturnValue([1, 42161, 8453]);

        await expect(
          service.discover({
            poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
            chainId: 999,
          })
        ).rejects.toThrow(/Chain 999 is not configured/);
      });
    });

    describe('contract errors', () => {
      it('should throw PoolConfigError for non-compliant contract', async () => {
        // Mock: Pool doesn't exist
        prismaMock.pool.findFirst.mockResolvedValue(null);

        // Mock: Chain is supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Multicall fails (not a valid pool contract)
        publicClientMock.multicall.mockRejectedValue(
          new Error('execution reverted')
        );

        await expect(
          service.discover({
            poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
            chainId: 1,
          })
        ).rejects.toThrow();
      });
    });
  });

  // ==========================================================================
  // create() Tests
  // ==========================================================================

  describe('create', () => {
    describe('successful creation', () => {
      it('should create new pool with valid data', async () => {
        const { input, dbResult } = USDC_WETH_POOL;

        // Mock: Base create
        prismaMock.pool.create.mockResolvedValue(dbResult);

        // Mock: Find by address (re-fetch after creation)
        prismaMock.pool.findFirst.mockResolvedValue(dbResult);

        // Execute
        const result = await service.create(input);

        // Verify
        expect(result.id).toBe(dbResult.id);
        expect(result.protocol).toBe('uniswapv3');
        expect(result.token0.symbol).toBe('USDC');
        expect(result.token1.symbol).toBe('WETH');
        expect(prismaMock.pool.create).toHaveBeenCalledTimes(1);
      });

      it('should normalize pool address', async () => {
        const fixture = createPoolFixture({
          config: {
            ...USDC_WETH_CONFIG,
            address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', // lowercase
          },
        });

        // Mock
        prismaMock.pool.create.mockResolvedValue(fixture.dbResult);
        prismaMock.pool.findFirst.mockResolvedValue(fixture.dbResult);

        // Execute
        await service.create(fixture.input);

        // Verify address was normalized in create call
        expect(prismaMock.pool.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              config: expect.objectContaining({
                address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // checksummed
              }),
            }),
          })
        );
      });

      it('should normalize token addresses in config', async () => {
        const fixture = createPoolFixture({
          config: {
            ...USDC_WETH_CONFIG,
            token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // lowercase
            token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // lowercase
          },
        });

        // Mock
        prismaMock.pool.create.mockResolvedValue(fixture.dbResult);
        prismaMock.pool.findFirst.mockResolvedValue(fixture.dbResult);

        // Execute
        await service.create(fixture.input);

        // Verify addresses were normalized
        expect(prismaMock.pool.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              config: expect.objectContaining({
                token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              }),
            }),
          })
        );
      });
    });

    describe('validation errors', () => {
      it('should throw error for invalid pool address', async () => {
        const fixture = createPoolFixture({
          config: {
            ...USDC_WETH_CONFIG,
            address: 'invalid',
          },
        });

        await expect(service.create(fixture.input)).rejects.toThrow(
          'Invalid pool address format'
        );
      });

      it('should throw error for invalid token0 address', async () => {
        const fixture = createPoolFixture({
          config: {
            ...USDC_WETH_CONFIG,
            token0: 'invalid',
          },
        });

        await expect(service.create(fixture.input)).rejects.toThrow(
          'Invalid token0 address format'
        );
      });

      it('should throw error for invalid token1 address', async () => {
        const fixture = createPoolFixture({
          config: {
            ...USDC_WETH_CONFIG,
            token1: 'invalid',
          },
        });

        await expect(service.create(fixture.input)).rejects.toThrow(
          'Invalid token1 address format'
        );
      });
    });
  });

  // ==========================================================================
  // findById() Tests
  // ==========================================================================

  describe('findById', () => {
    it('should find existing Uniswap V3 pool', async () => {
      const { dbResult, pool } = USDC_WETH_POOL;

      prismaMock.pool.findUnique.mockResolvedValue(dbResult);

      const result = await service.findById('pool_usdc_weth_001');

      expect(result).not.toBeNull();
      expect(result?.id).toBe(pool.id);
      expect(result?.protocol).toBe('uniswapv3');
      expect(result?.token0.symbol).toBe('USDC');
      expect(result?.token1.symbol).toBe('WETH');
    });

    it('should return null when pool not found', async () => {
      prismaMock.pool.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for wrong protocol type', async () => {
      const dbResult = {
        ...USDC_WETH_POOL.dbResult,
        protocol: 'pancakeswapv3', // Different protocol
      };

      prismaMock.pool.findUnique.mockResolvedValue(dbResult as any);

      const result = await service.findById('pool_usdc_weth_001');

      expect(result).toBeNull();
    });

    it('should populate full Token objects', async () => {
      const { dbResult } = USDC_WETH_POOL;

      prismaMock.pool.findUnique.mockResolvedValue(dbResult);

      const result = await service.findById('pool_usdc_weth_001');

      expect(result?.token0).toMatchObject({
        id: USDC_TOKEN.id,
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
      });

      expect(result?.token1).toMatchObject({
        id: WETH_TOKEN.id,
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
      });
    });
  });

  // ==========================================================================
  // update() Tests
  // ==========================================================================

  describe('update', () => {
    describe('successful updates', () => {
      it('should update feeBps', async () => {
        const { dbResult } = USDC_WETH_POOL;
        const updatedConfig = { ...dbResult.config, feeBps: 3000 };
        const updated = { ...dbResult, feeBps: 3000, config: updatedConfig };

        prismaMock.pool.update.mockResolvedValue(updated);
        prismaMock.pool.findUnique.mockResolvedValue(updated);

        const result = await service.update('pool_usdc_weth_001', {
          feeBps: 3000,
        });

        expect(result.feeBps).toBe(3000);
      });

      it('should update config with address normalization', async () => {
        const { dbResult } = USDC_WETH_POOL;
        const newConfig = {
          ...USDC_WETH_CONFIG,
          address: '0x0000000000000000000000000000000000000001',
        };
        const updated = {
          ...dbResult,
          config: {
            ...dbResult.config,
            address: '0x0000000000000000000000000000000000000001',
          },
        };

        prismaMock.pool.update.mockResolvedValue(updated);
        prismaMock.pool.findUnique.mockResolvedValue(updated);

        await service.update('pool_usdc_weth_001', {
          config: newConfig,
        });

        // Verify address was normalized
        expect(prismaMock.pool.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              config: expect.objectContaining({
                address: '0x0000000000000000000000000000000000000001',
              }),
            }),
          })
        );
      });

      it('should update state with bigint values', async () => {
        const { dbResult } = USDC_WETH_POOL;
        const newState = {
          sqrtPriceX96: 5555555555555555555555n,
          currentTick: 300000,
          liquidity: 8888888888888888888n,
          feeGrowthGlobal0: 333333333333333333n,
          feeGrowthGlobal1: 444444444444444444n,
        };
        const updated = {
          ...dbResult,
          state: {
            sqrtPriceX96: '5555555555555555555555',
            currentTick: 300000,
            liquidity: '8888888888888888888',
            feeGrowthGlobal0: '333333333333333333',
            feeGrowthGlobal1: '444444444444444444',
          },
        };

        prismaMock.pool.update.mockResolvedValue(updated);
        prismaMock.pool.findUnique.mockResolvedValue(updated);

        const result = await service.update('pool_usdc_weth_001', {
          state: newState,
        });

        expect(result.state.sqrtPriceX96).toBe(5555555555555555555555n);
        expect(result.state.currentTick).toBe(300000);
      });
    });

    describe('validation errors', () => {
      it('should throw error for pool not found', async () => {
        prismaMock.pool.update.mockRejectedValue(new Error('Record not found'));

        await expect(
          service.update('nonexistent', { feeBps: 3000 })
        ).rejects.toThrow();
      });

      it('should throw error for invalid address in config', async () => {
        const newConfig = {
          ...USDC_WETH_CONFIG,
          address: 'invalid',
        };

        await expect(
          service.update('pool_usdc_weth_001', { config: newConfig })
        ).rejects.toThrow('Invalid pool address format');
      });
    });
  });

  // ==========================================================================
  // delete() Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete existing pool', async () => {
      const { dbResult } = USDC_WETH_POOL;

      prismaMock.pool.findUnique.mockResolvedValue({
        ...dbResult,
        positions: [], // No positions
      } as any);

      prismaMock.pool.delete.mockResolvedValue(dbResult);

      await service.delete('pool_usdc_weth_001');

      expect(prismaMock.pool.delete).toHaveBeenCalledWith({
        where: { id: 'pool_usdc_weth_001' },
      });
    });

    it('should succeed silently if pool does not exist', async () => {
      prismaMock.pool.findUnique.mockResolvedValue(null);

      // Should not throw
      await expect(service.delete('nonexistent')).resolves.toBeUndefined();

      // Verify delete was not called
      expect(prismaMock.pool.delete).not.toHaveBeenCalled();
    });

    it('should throw error if wrong protocol type', async () => {
      const dbResult = {
        ...USDC_WETH_POOL.dbResult,
        protocol: 'pancakeswapv3',
        positions: [],
      };

      prismaMock.pool.findUnique.mockResolvedValue(dbResult as any);

      await expect(service.delete('pool_usdc_weth_001')).rejects.toThrow(
        "expected protocol 'uniswapv3'"
      );
    });

    it('should throw error if pool has dependent positions', async () => {
      const dbResult = {
        ...USDC_WETH_POOL.dbResult,
        positions: [{ id: 'position_001' }], // Has positions
      };

      prismaMock.pool.findUnique.mockResolvedValue(dbResult as any);

      await expect(service.delete('pool_usdc_weth_001')).rejects.toThrow(
        'pool has dependent positions'
      );
    });
  });

  // ==========================================================================
  // refresh() Tests
  // ==========================================================================

  describe('refresh', () => {
    describe('successful refresh', () => {
      it('should refresh pool state from on-chain', async () => {
        const { dbResult } = USDC_WETH_POOL;

        // Mock: Find existing pool
        prismaMock.pool.findUnique
          .mockResolvedValueOnce(dbResult) // findById call
          .mockResolvedValueOnce({
            ...dbResult,
            state: {
              sqrtPriceX96: '9999999999999999999999',
              currentTick: 400000,
              liquidity: '7777777777777777777',
              feeGrowthGlobal0: '555555555555555555',
              feeGrowthGlobal1: '666666666666666666',
            },
          }); // after update

        // Mock: Chain is supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Read fresh state from on-chain
        publicClientMock.multicall.mockResolvedValue([
          [9999999999999999999999n, 400000], // slot0
          7777777777777777777n, // liquidity
          555555555555555555n, // feeGrowthGlobal0
          666666666666666666n, // feeGrowthGlobal1
        ] as any);

        // Mock: Update
        prismaMock.pool.update.mockResolvedValue({
          ...dbResult,
          state: {
            sqrtPriceX96: '9999999999999999999999',
            currentTick: 400000,
            liquidity: '7777777777777777777',
            feeGrowthGlobal0: '555555555555555555',
            feeGrowthGlobal1: '666666666666666666',
          },
        });

        // Execute
        const result = await service.refresh('pool_usdc_weth_001');

        // Verify
        expect(result.state.sqrtPriceX96).toBe(9999999999999999999999n);
        expect(result.state.currentTick).toBe(400000);
        expect(result.state.liquidity).toBe(7777777777777777777n);
      });
    });

    describe('error handling', () => {
      it('should throw error if pool not found', async () => {
        prismaMock.pool.findUnique.mockResolvedValue(null);

        await expect(service.refresh('nonexistent')).rejects.toThrow(
          'Pool not found'
        );
      });

      it('should throw error for unsupported chain', async () => {
        const { dbResult } = USDC_WETH_POOL;

        prismaMock.pool.findUnique.mockResolvedValue(dbResult);
        evmConfigMock.isChainSupported.mockReturnValue(false);

        await expect(service.refresh('pool_usdc_weth_001')).rejects.toThrow(
          'is not supported or not configured'
        );
      });

      it('should wrap on-chain read errors', async () => {
        const { dbResult } = USDC_WETH_POOL;

        prismaMock.pool.findUnique.mockResolvedValue(dbResult);
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        publicClientMock.multicall.mockRejectedValue(
          new Error('Network error')
        );

        await expect(service.refresh('pool_usdc_weth_001')).rejects.toThrow(
          'Failed to read pool state'
        );
      });
    });
  });
});
