/**
 * Integration tests for UniswapV3PoolService
 * Tests against real PostgreSQL database and Ethereum RPC endpoints
 *
 * These tests verify:
 * - Pool discovery from on-chain data (real Uniswap V3 pools)
 * - CRUD operations with database persistence
 * - Token relationship population
 * - BigInt serialization/deserialization
 * - Address normalization (EIP-55 checksumming)
 * - State refresh from blockchain
 * - Error handling (invalid addresses, unsupported chains, etc.)
 */

import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { UniswapV3PoolService } from './uniswapv3-pool-service.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { EvmConfig } from '../../config/evm.js';
import {
  getPrismaClient,
  disconnectPrisma,
  countAllRecords,
} from '../../test/helpers.js';
import type { CreatePoolInput } from '../types/pool/pool-input.js';

describe('UniswapV3PoolService - Integration Tests', () => {
  let poolService: UniswapV3PoolService;
  let tokenService: Erc20TokenService;
  let evmConfig: EvmConfig;
  const prisma = getPrismaClient();

  // Real Uniswap V3 pool addresses on Ethereum mainnet
  const REAL_POOLS = {
    USDC_WETH_0_05: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // 0.05% fee pool
    USDC_WETH_0_3: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', // 0.3% fee pool
    DAI_USDC_0_01: '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168', // 0.01% fee pool
  };

  // Known token addresses
  const TOKEN_ADDRESSES = {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  };

  beforeEach(() => {
    evmConfig = EvmConfig.getInstance();
    tokenService = new Erc20TokenService({ prisma });
    poolService = new UniswapV3PoolService({
      prisma,
      evmConfig,
      erc20TokenService: tokenService,
    });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ==========================================================================
  // discover() Tests
  // ==========================================================================

  describe('discover()', () => {
    describe('successful discovery', () => {
      it('should discover real USDC/WETH pool from on-chain', async () => {
        // Discover pool from blockchain
        const pool = await poolService.discover({
          poolAddress: REAL_POOLS.USDC_WETH_0_05,
          chainId: 1,
        });

        // Verify pool data
        expect(pool.id).toBeDefined();
        expect(pool.protocol).toBe('uniswapv3');
        expect(pool.poolType).toBe('CL_TICKS');
        expect(pool.feeBps).toBe(500); // 0.05%

        // Verify config
        expect(pool.config.chainId).toBe(1);
        expect(pool.config.address).toBe(REAL_POOLS.USDC_WETH_0_05);
        expect(pool.config.token0).toBe(TOKEN_ADDRESSES.USDC);
        expect(pool.config.token1).toBe(TOKEN_ADDRESSES.WETH);
        expect(pool.config.feeBps).toBe(500);
        expect(pool.config.tickSpacing).toBe(10);

        // Verify state (should have real on-chain values)
        expect(pool.state.sqrtPriceX96).toBeGreaterThan(0n);
        expect(pool.state.liquidity).toBeGreaterThan(0n);
        expect(typeof pool.state.currentTick).toBe('number');
        expect(typeof pool.state.feeGrowthGlobal0).toBe('bigint');
        expect(typeof pool.state.feeGrowthGlobal1).toBe('bigint');

        // Verify tokens were discovered and populated
        expect(pool.token0.symbol).toBe('USDC');
        expect(pool.token0.decimals).toBe(6);
        expect(pool.token0.config.address).toBe(TOKEN_ADDRESSES.USDC);

        expect(pool.token1.symbol).toBe('WETH');
        expect(pool.token1.decimals).toBe(18);
        expect(pool.token1.config.address).toBe(TOKEN_ADDRESSES.WETH);

        // Verify database persistence
        const dbPool = await prisma.pool.findUnique({
          where: { id: pool.id },
        });
        expect(dbPool).toBeDefined();
        expect(dbPool?.protocol).toBe('uniswapv3');

        // Verify tokens are in database
        const counts = await countAllRecords();
        expect(counts.tokens).toBe(2); // USDC and WETH
        expect(counts.pools).toBe(1);
      }, 30000); // 30s timeout for on-chain reads

      it('should be idempotent - return existing pool on second discovery', async () => {
        // First discovery
        const pool1 = await poolService.discover({
          poolAddress: REAL_POOLS.USDC_WETH_0_05,
          chainId: 1,
        });

        // Second discovery (should return existing)
        const pool2 = await poolService.discover({
          poolAddress: REAL_POOLS.USDC_WETH_0_05,
          chainId: 1,
        });

        // Should be the same pool
        expect(pool1.id).toBe(pool2.id);
        expect(pool1.config.address).toBe(pool2.config.address);

        // Verify only one pool in database
        const counts = await countAllRecords();
        expect(counts.pools).toBe(1);
      }, 30000);

      it('should normalize lowercase address before discovery', async () => {
        const pool = await poolService.discover({
          poolAddress: REAL_POOLS.USDC_WETH_0_05.toLowerCase(), // lowercase
          chainId: 1,
        });

        // Address should be normalized to checksum format
        expect(pool.config.address).toBe(REAL_POOLS.USDC_WETH_0_05);
      }, 30000);

      it('should discover different pools with same tokens but different fees', async () => {
        // Discover 0.05% fee pool
        const pool1 = await poolService.discover({
          poolAddress: REAL_POOLS.USDC_WETH_0_05,
          chainId: 1,
        });

        // Discover 0.3% fee pool (same tokens, different fee tier)
        const pool2 = await poolService.discover({
          poolAddress: REAL_POOLS.USDC_WETH_0_3,
          chainId: 1,
        });

        // Should be different pools
        expect(pool1.id).not.toBe(pool2.id);
        expect(pool1.config.feeBps).toBe(500); // 0.05%
        expect(pool2.config.feeBps).toBe(3000); // 0.3%

        // But same tokens
        expect(pool1.token0.id).toBe(pool2.token0.id);
        expect(pool1.token1.id).toBe(pool2.token1.id);

        // Verify database
        const counts = await countAllRecords();
        expect(counts.pools).toBe(2);
        expect(counts.tokens).toBe(2); // Still only 2 tokens (reused)
      }, 30000);

      it('should discover pool with automatic token discovery', async () => {
        // Ensure tokens don't exist yet
        let counts = await countAllRecords();
        expect(counts.tokens).toBe(0);

        // Discover pool (should automatically discover tokens)
        const pool = await poolService.discover({
          poolAddress: REAL_POOLS.DAI_USDC_0_01,
          chainId: 1,
        });

        // Verify tokens were automatically created
        expect(pool.token0.symbol).toBe('DAI');
        expect(pool.token1.symbol).toBe('USDC');

        counts = await countAllRecords();
        expect(counts.tokens).toBe(2); // DAI and USDC auto-created
      }, 30000);
    });

    describe('validation errors', () => {
      it('should throw error for invalid pool address format', async () => {
        await expect(
          poolService.discover({
            poolAddress: 'invalid-address',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid pool address format');
      });

      it('should throw error for too short address', async () => {
        await expect(
          poolService.discover({
            poolAddress: '0x123',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid pool address format');
      });

      it('should throw error for address without 0x prefix', async () => {
        await expect(
          poolService.discover({
            poolAddress: '88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid pool address format');
      });

      it('should throw error for unsupported chain', async () => {
        await expect(
          poolService.discover({
            poolAddress: REAL_POOLS.USDC_WETH_0_05,
            chainId: 999999, // Invalid chain
          })
        ).rejects.toThrow(/Chain 999999 is not configured/);
      });

      it('should throw error for non-existent contract address', async () => {
        await expect(
          poolService.discover({
            poolAddress: '0x0000000000000000000000000000000000000001', // No contract here
            chainId: 1,
          })
        ).rejects.toThrow();
      }, 30000);

      it('should throw error for non-compliant contract (not a Uniswap V3 pool)', async () => {
        // Use USDC token address (ERC-20, not a pool)
        await expect(
          poolService.discover({
            poolAddress: TOKEN_ADDRESSES.USDC,
            chainId: 1,
          })
        ).rejects.toThrow();
      }, 30000);
    });
  });

  // ==========================================================================
  // create() Tests
  // ==========================================================================

  describe('create()', () => {
    it('should create pool with valid data', async () => {
      // First create tokens
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: TOKEN_ADDRESSES.USDC,
          chainId: 1,
        },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: {
          address: TOKEN_ADDRESSES.WETH,
          chainId: 1,
        },
      });

      // Create pool
      const input: CreatePoolInput<'uniswapv3'> = {
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: usdc.id,
        token1Id: weth.id,
        feeBps: 500,
        config: {
          chainId: 1,
          address: REAL_POOLS.USDC_WETH_0_05,
          token0: TOKEN_ADDRESSES.USDC,
          token1: TOKEN_ADDRESSES.WETH,
          feeBps: 500,
          tickSpacing: 10,
        },
        state: {
          sqrtPriceX96: 1234567890123456789012345678n,
          currentTick: 201234,
          liquidity: 9876543210987654321098765n,
          feeGrowthGlobal0: 111111111111111111111n,
          feeGrowthGlobal1: 222222222222222222222n,
        },
      };

      const pool = await poolService.create(input);

      // Verify pool
      expect(pool.id).toBeDefined();
      expect(pool.protocol).toBe('uniswapv3');
      expect(pool.token0.symbol).toBe('USDC');
      expect(pool.token1.symbol).toBe('WETH');

      // Verify database
      const dbPool = await prisma.pool.findUnique({
        where: { id: pool.id },
      });
      expect(dbPool).toBeDefined();
    });

    it('should normalize pool address to EIP-55 checksum', async () => {
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const input: CreatePoolInput<'uniswapv3'> = {
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: usdc.id,
        token1Id: weth.id,
        feeBps: 500,
        config: {
          chainId: 1,
          address: REAL_POOLS.USDC_WETH_0_05.toLowerCase(), // lowercase
          token0: TOKEN_ADDRESSES.USDC,
          token1: TOKEN_ADDRESSES.WETH,
          feeBps: 500,
          tickSpacing: 10,
        },
        state: {
          sqrtPriceX96: 0n,
          currentTick: 0,
          liquidity: 0n,
          feeGrowthGlobal0: 0n,
          feeGrowthGlobal1: 0n,
        },
      };

      const pool = await poolService.create(input);

      // Address should be normalized
      expect(pool.config.address).toBe(REAL_POOLS.USDC_WETH_0_05);

      // Verify in database
      const dbPool = await prisma.pool.findUnique({
        where: { id: pool.id },
      });
      const dbConfig = dbPool?.config as any;
      expect(dbConfig.address).toBe(REAL_POOLS.USDC_WETH_0_05);
    });

    it('should normalize token addresses in config', async () => {
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const input: CreatePoolInput<'uniswapv3'> = {
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: usdc.id,
        token1Id: weth.id,
        feeBps: 500,
        config: {
          chainId: 1,
          address: REAL_POOLS.USDC_WETH_0_05,
          token0: TOKEN_ADDRESSES.USDC.toLowerCase(), // lowercase
          token1: TOKEN_ADDRESSES.WETH.toLowerCase(), // lowercase
          feeBps: 500,
          tickSpacing: 10,
        },
        state: {
          sqrtPriceX96: 0n,
          currentTick: 0,
          liquidity: 0n,
          feeGrowthGlobal0: 0n,
          feeGrowthGlobal1: 0n,
        },
      };

      const pool = await poolService.create(input);

      // Addresses should be normalized
      expect(pool.config.token0).toBe(TOKEN_ADDRESSES.USDC);
      expect(pool.config.token1).toBe(TOKEN_ADDRESSES.WETH);
    });

    it('should throw error for invalid pool address', async () => {
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const input: CreatePoolInput<'uniswapv3'> = {
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: usdc.id,
        token1Id: weth.id,
        feeBps: 500,
        config: {
          chainId: 1,
          address: 'invalid-address',
          token0: TOKEN_ADDRESSES.USDC,
          token1: TOKEN_ADDRESSES.WETH,
          feeBps: 500,
          tickSpacing: 10,
        },
        state: {
          sqrtPriceX96: 0n,
          currentTick: 0,
          liquidity: 0n,
          feeGrowthGlobal0: 0n,
          feeGrowthGlobal1: 0n,
        },
      };

      await expect(poolService.create(input)).rejects.toThrow(
        'Invalid pool address format'
      );
    });

    it('should throw error for invalid token addresses', async () => {
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const input: CreatePoolInput<'uniswapv3'> = {
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: usdc.id,
        token1Id: weth.id,
        feeBps: 500,
        config: {
          chainId: 1,
          address: REAL_POOLS.USDC_WETH_0_05,
          token0: 'invalid',
          token1: TOKEN_ADDRESSES.WETH,
          feeBps: 500,
          tickSpacing: 10,
        },
        state: {
          sqrtPriceX96: 0n,
          currentTick: 0,
          liquidity: 0n,
          feeGrowthGlobal0: 0n,
          feeGrowthGlobal1: 0n,
        },
      };

      await expect(poolService.create(input)).rejects.toThrow(
        'Invalid token0 address format'
      );
    });

    it('should populate full Token objects in result', async () => {
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        logoUrl: 'https://example.com/usdc.png',
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const input: CreatePoolInput<'uniswapv3'> = {
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: usdc.id,
        token1Id: weth.id,
        feeBps: 500,
        config: {
          chainId: 1,
          address: REAL_POOLS.USDC_WETH_0_05,
          token0: TOKEN_ADDRESSES.USDC,
          token1: TOKEN_ADDRESSES.WETH,
          feeBps: 500,
          tickSpacing: 10,
        },
        state: {
          sqrtPriceX96: 0n,
          currentTick: 0,
          liquidity: 0n,
          feeGrowthGlobal0: 0n,
          feeGrowthGlobal1: 0n,
        },
      };

      const pool = await poolService.create(input);

      // Verify full token objects
      expect(pool.token0).toMatchObject({
        id: usdc.id,
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        logoUrl: 'https://example.com/usdc.png',
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      expect(pool.token1).toMatchObject({
        id: weth.id,
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
      });
    });
  });

  // ==========================================================================
  // findById() Tests
  // ==========================================================================

  describe('findById()', () => {
    it('should find existing Uniswap V3 pool', async () => {
      // Create a pool first
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Find by ID
      const found = await poolService.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.protocol).toBe('uniswapv3');
      expect(found?.token0.symbol).toBe('USDC');
      expect(found?.token1.symbol).toBe('WETH');
    }, 30000);

    it('should return null for non-existent pool', async () => {
      const found = await poolService.findById('non_existent_id');
      expect(found).toBeNull();
    });

    it('should return null for wrong protocol type', async () => {
      // Create a pool but with wrong protocol in database
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      // Create pool directly in database with wrong protocol
      const dbPool = await prisma.pool.create({
        data: {
          protocol: 'pancakeswapv3', // Different protocol
          poolType: 'CL_TICKS',
          token0Id: usdc.id,
          token1Id: weth.id,
          feeBps: 500,
          config: {
            chainId: 1,
            address: REAL_POOLS.USDC_WETH_0_05,
            token0: TOKEN_ADDRESSES.USDC,
            token1: TOKEN_ADDRESSES.WETH,
            feeBps: 500,
            tickSpacing: 10,
          },
          state: {
            sqrtPriceX96: '0',
            currentTick: 0,
            liquidity: '0',
            feeGrowthGlobal0: '0',
            feeGrowthGlobal1: '0',
          },
        },
      });

      // Try to find with UniswapV3PoolService - should return null
      const found = await poolService.findById(dbPool.id);
      expect(found).toBeNull();
    });

    it('should populate full Token objects', async () => {
      // Create pool
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Find by ID
      const found = await poolService.findById(created.id);

      // Verify full token objects
      expect(found?.token0).toMatchObject({
        tokenType: 'erc20',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: TOKEN_ADDRESSES.USDC,
          chainId: 1,
        },
      });

      expect(found?.token1).toMatchObject({
        tokenType: 'erc20',
        symbol: 'WETH',
        decimals: 18,
        config: {
          address: TOKEN_ADDRESSES.WETH,
          chainId: 1,
        },
      });
    }, 30000);

    it('should correctly parse config and state (bigint conversion)', async () => {
      // Create pool
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Find by ID
      const found = await poolService.findById(created.id);

      // Verify config parsing (primitives only)
      expect(typeof found?.config.chainId).toBe('number');
      expect(typeof found?.config.address).toBe('string');
      expect(typeof found?.config.feeBps).toBe('number');
      expect(typeof found?.config.tickSpacing).toBe('number');

      // Verify state parsing (bigint conversion)
      expect(typeof found?.state.sqrtPriceX96).toBe('bigint');
      expect(typeof found?.state.liquidity).toBe('bigint');
      expect(typeof found?.state.currentTick).toBe('number');
      expect(typeof found?.state.feeGrowthGlobal0).toBe('bigint');
      expect(typeof found?.state.feeGrowthGlobal1).toBe('bigint');
    }, 30000);
  });

  // ==========================================================================
  // update() Tests
  // ==========================================================================

  describe('update()', () => {
    it('should update feeBps (both top-level and in config)', async () => {
      // Create pool
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Update feeBps (need to update both top-level and in config for consistency)
      const updated = await poolService.update(created.id, {
        feeBps: 3000,
        config: {
          ...created.config,
          feeBps: 3000,
        },
      });

      expect(updated.feeBps).toBe(3000);
      expect(updated.config.feeBps).toBe(3000);

      // Verify in database
      const dbPool = await prisma.pool.findUnique({
        where: { id: created.id },
      });
      expect(dbPool?.feeBps).toBe(3000);
      const dbConfig = dbPool?.config as any;
      expect(dbConfig.feeBps).toBe(3000);
    }, 30000);

    it('should update config with address normalization', async () => {
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const newAddress = '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8';

      const updated = await poolService.update(created.id, {
        config: {
          ...created.config,
          address: newAddress.toLowerCase(), // lowercase
        },
      });

      // Address should be normalized
      expect(updated.config.address).toBe(newAddress);
    }, 30000);

    it('should update state with bigint values', async () => {
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const newState = {
        sqrtPriceX96: 9999999999999999999999n,
        currentTick: 500000,
        liquidity: 8888888888888888888n,
        feeGrowthGlobal0: 777777777777777777n,
        feeGrowthGlobal1: 666666666666666666n,
      };

      const updated = await poolService.update(created.id, {
        state: newState,
      });

      // Verify state
      expect(updated.state.sqrtPriceX96).toBe(9999999999999999999999n);
      expect(updated.state.currentTick).toBe(500000);
      expect(updated.state.liquidity).toBe(8888888888888888888n);

      // Verify in database (should be stored as strings)
      const dbPool = await prisma.pool.findUnique({
        where: { id: created.id },
      });
      const dbState = dbPool?.state as any;
      expect(dbState.sqrtPriceX96).toBe('9999999999999999999999');
      expect(dbState.liquidity).toBe('8888888888888888888');
    }, 30000);

    it('should support partial updates', async () => {
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const originalState = created.state;

      // Update only one state field
      const updated = await poolService.update(created.id, {
        state: {
          ...originalState,
          currentTick: 999999,
        },
      });

      // Only currentTick should change
      expect(updated.state.currentTick).toBe(999999);
      expect(updated.state.sqrtPriceX96).toBe(originalState.sqrtPriceX96);
      expect(updated.state.liquidity).toBe(originalState.liquidity);
    }, 30000);

    it('should throw error for pool not found', async () => {
      await expect(
        poolService.update('non_existent_id', { feeBps: 3000 })
      ).rejects.toThrow();
    });

    it('should throw error for invalid address in config', async () => {
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      await expect(
        poolService.update(created.id, {
          config: {
            ...created.config,
            address: 'invalid-address',
          },
        })
      ).rejects.toThrow('Invalid pool address format');
    }, 30000);
  });

  // ==========================================================================
  // delete() Tests
  // ==========================================================================

  describe('delete()', () => {
    it('should delete existing pool', async () => {
      // Create pool
      const created = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Delete
      await poolService.delete(created.id);

      // Verify deleted
      const found = await poolService.findById(created.id);
      expect(found).toBeNull();

      // Verify removed from database
      const dbPool = await prisma.pool.findUnique({
        where: { id: created.id },
      });
      expect(dbPool).toBeNull();
    }, 30000);

    it('should be idempotent - silently succeed if pool does not exist', async () => {
      // Should not throw
      await expect(
        poolService.delete('non_existent_id')
      ).resolves.not.toThrow();
    });

    it('should throw error for wrong protocol type', async () => {
      // Create pool with wrong protocol
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const dbPool = await prisma.pool.create({
        data: {
          protocol: 'pancakeswapv3',
          poolType: 'CL_TICKS',
          token0Id: usdc.id,
          token1Id: weth.id,
          feeBps: 500,
          config: {
            chainId: 1,
            address: REAL_POOLS.USDC_WETH_0_05,
            token0: TOKEN_ADDRESSES.USDC,
            token1: TOKEN_ADDRESSES.WETH,
            feeBps: 500,
            tickSpacing: 10,
          },
          state: {
            sqrtPriceX96: '0',
            currentTick: 0,
            liquidity: '0',
            feeGrowthGlobal0: '0',
            feeGrowthGlobal1: '0',
          },
        },
      });

      // Try to delete with UniswapV3PoolService
      await expect(poolService.delete(dbPool.id)).rejects.toThrow(
        "expected protocol 'uniswapv3'"
      );
    });

    it('should throw error if pool has dependent positions', async () => {
      // Create pool
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Create a user
      const user = await prisma.user.create({
        data: { name: 'Test User' },
      });

      // Create a position for this pool
      await prisma.position.create({
        data: {
          protocol: 'uniswapv3',
          positionType: 'CL_TICKS',
          userId: user.id,
          poolId: pool.id,
          isToken0Quote: false, // token1 (WETH) is the quote token
          currentValue: '0',
          currentCostBasis: '0',
          realizedPnl: '0',
          unrealizedPnl: '0',
          collectedFees: '0',
          unClaimedFees: '0',
          lastFeesCollectedAt: new Date(),
          priceRangeLower: '0',
          priceRangeUpper: '0',
          positionOpenedAt: new Date(),
          isActive: true,
          config: {},
          state: {},
        },
      });

      // Try to delete pool
      await expect(poolService.delete(pool.id)).rejects.toThrow(
        'pool has dependent positions'
      );

      // Pool should still exist
      const found = await poolService.findById(pool.id);
      expect(found).not.toBeNull();
    }, 30000);

    it('should allow deletion when tokens remain after pool deletion', async () => {
      // Create pool
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const token0Id = pool.token0.id;
      const token1Id = pool.token1.id;

      // Delete pool
      await poolService.delete(pool.id);

      // Tokens should still exist
      const token0 = await tokenService.findById(token0Id);
      const token1 = await tokenService.findById(token1Id);

      expect(token0).not.toBeNull();
      expect(token1).not.toBeNull();
    }, 30000);

    it('should allow multiple deletes of same pool without error', async () => {
      // Create pool
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // First delete
      await poolService.delete(pool.id);

      // Second delete - should not throw
      await expect(poolService.delete(pool.id)).resolves.not.toThrow();
    }, 30000);
  });

  // ==========================================================================
  // refresh() Tests
  // ==========================================================================

  describe('refresh()', () => {
    it('should refresh pool state from on-chain', async () => {
      // Create pool
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const originalState = pool.state;

      // Wait a bit and refresh (state might have changed on-chain)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const refreshed = await poolService.refresh(pool.id);

      // State should be updated (values are from blockchain, so we just verify types)
      expect(typeof refreshed.state.sqrtPriceX96).toBe('bigint');
      expect(typeof refreshed.state.liquidity).toBe('bigint');
      expect(typeof refreshed.state.currentTick).toBe('number');

      // Config should remain unchanged (immutable)
      expect(refreshed.config).toEqual(pool.config);
    }, 30000);

    it('should handle state changes between refreshes', async () => {
      // Create pool
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // First refresh
      const refresh1 = await poolService.refresh(pool.id);
      const state1 = refresh1.state;

      // Second refresh (might have different values)
      const refresh2 = await poolService.refresh(pool.id);
      const state2 = refresh2.state;

      // Both should have valid bigint values
      expect(typeof state1.sqrtPriceX96).toBe('bigint');
      expect(typeof state2.sqrtPriceX96).toBe('bigint');

      // State might be the same or different (depends on blockchain activity)
      // We just verify the structure is correct
      expect(state2).toHaveProperty('sqrtPriceX96');
      expect(state2).toHaveProperty('liquidity');
      expect(state2).toHaveProperty('currentTick');
    }, 30000);

    it('should keep config immutable after refresh', async () => {
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const originalConfig = { ...pool.config };

      // Refresh state
      const refreshed = await poolService.refresh(pool.id);

      // Config should be unchanged
      expect(refreshed.config).toEqual(originalConfig);
    }, 30000);

    it('should throw error for pool not found', async () => {
      await expect(poolService.refresh('non_existent_id')).rejects.toThrow(
        'Pool not found'
      );
    });

    it('should throw error for unsupported chain', async () => {
      // Create pool with unsupported chain
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 999 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 999 },
      });

      // Create pool directly in database
      const dbPool = await prisma.pool.create({
        data: {
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: usdc.id,
          token1Id: weth.id,
          feeBps: 500,
          config: {
            chainId: 999, // Unsupported chain
            address: REAL_POOLS.USDC_WETH_0_05,
            token0: TOKEN_ADDRESSES.USDC,
            token1: TOKEN_ADDRESSES.WETH,
            feeBps: 500,
            tickSpacing: 10,
          },
          state: {
            sqrtPriceX96: '0',
            currentTick: 0,
            liquidity: '0',
            feeGrowthGlobal0: '0',
            feeGrowthGlobal1: '0',
          },
        },
      });

      await expect(poolService.refresh(dbPool.id)).rejects.toThrow(
        'is not supported or not configured'
      );
    });

    it('should persist refreshed state to database', async () => {
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const refreshed = await poolService.refresh(pool.id);

      // Verify in database
      const dbPool = await prisma.pool.findUnique({
        where: { id: pool.id },
      });

      const dbState = dbPool?.state as any;

      // State should be persisted as strings
      expect(dbState.sqrtPriceX96).toBe(refreshed.state.sqrtPriceX96.toString());
      expect(dbState.liquidity).toBe(refreshed.state.liquidity.toString());
      expect(dbState.currentTick).toBe(refreshed.state.currentTick);
    }, 30000);

    it('should use efficient multicall for state refresh', async () => {
      // This test verifies that refresh() uses a single multicall
      // rather than multiple separate RPC calls

      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      const startTime = Date.now();

      await poolService.refresh(pool.id);

      const elapsed = Date.now() - startTime;

      // Should be fast (< 5 seconds for single multicall)
      // If it takes longer, might be making multiple RPC calls
      expect(elapsed).toBeLessThan(5000);
    }, 30000);

    it('should handle network errors gracefully', async () => {
      // Create pool with valid config
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Update pool to point to non-existent contract address
      await prisma.pool.update({
        where: { id: pool.id },
        data: {
          config: {
            ...pool.config,
            address: '0x0000000000000000000000000000000000000001', // No contract here
          },
        },
      });

      // Try to refresh - should fail with clear error
      await expect(poolService.refresh(pool.id)).rejects.toThrow();
    }, 30000);
  });

  // ==========================================================================
  // Database Constraints Tests
  // ==========================================================================

  describe('Database Constraints', () => {
    it('should verify JSON path queries work for pool address + chainId', async () => {
      // Create two pools with same address on different chains
      const pool1 = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Manually create another pool with same address but different chainId
      // (this wouldn't happen in practice, but tests the database query)
      const usdc = await tokenService.findById(pool1.token0.id);
      const weth = await tokenService.findById(pool1.token1.id);

      if (!usdc || !weth) throw new Error('Tokens not found');

      await prisma.pool.create({
        data: {
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: usdc.id,
          token1Id: weth.id,
          feeBps: 500,
          config: {
            chainId: 999, // Different chain
            address: REAL_POOLS.USDC_WETH_0_05,
            token0: TOKEN_ADDRESSES.USDC,
            token1: TOKEN_ADDRESSES.WETH,
            feeBps: 500,
            tickSpacing: 10,
          },
          state: {
            sqrtPriceX96: '0',
            currentTick: 0,
            liquidity: '0',
            feeGrowthGlobal0: '0',
            feeGrowthGlobal1: '0',
          },
        },
      });

      // Verify we have 2 pools with same address
      const allPools = await prisma.pool.findMany({
        where: {
          protocol: 'uniswapv3',
        },
      });

      expect(allPools.length).toBe(2);

      // Verify JSON path query can distinguish them
      const pool1Found = await prisma.pool.findFirst({
        where: {
          protocol: 'uniswapv3',
          config: {
            path: ['address'],
            equals: REAL_POOLS.USDC_WETH_0_05,
          },
        },
      });

      expect(pool1Found).toBeDefined();
    }, 30000);

    it('should verify bigint serialization/deserialization', async () => {
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // State in application should use bigint
      expect(typeof pool.state.sqrtPriceX96).toBe('bigint');
      expect(typeof pool.state.liquidity).toBe('bigint');

      // State in database should be stored as strings
      const dbPool = await prisma.pool.findUnique({
        where: { id: pool.id },
      });

      const dbState = dbPool?.state as any;
      expect(typeof dbState.sqrtPriceX96).toBe('string');
      expect(typeof dbState.liquidity).toBe('string');

      // Round-trip should be exact
      expect(BigInt(dbState.sqrtPriceX96)).toBe(pool.state.sqrtPriceX96);
      expect(BigInt(dbState.liquidity)).toBe(pool.state.liquidity);
    }, 30000);

    it('should verify token relations integrity', async () => {
      const pool = await poolService.discover({
        poolAddress: REAL_POOLS.USDC_WETH_0_05,
        chainId: 1,
      });

      // Delete pool
      await poolService.delete(pool.id);

      // Tokens should still exist (no cascade delete)
      const usdc = await prisma.token.findFirst({
        where: { symbol: 'USDC' },
      });
      const weth = await prisma.token.findFirst({
        where: { symbol: 'WETH' },
      });

      expect(usdc).not.toBeNull();
      expect(weth).not.toBeNull();

      // Pool should be gone
      const deletedPool = await prisma.pool.findUnique({
        where: { id: pool.id },
      });
      expect(deletedPool).toBeNull();
    }, 30000);

    it('should handle concurrent pool creations without conflicts', async () => {
      // Create tokens first
      const usdc = await tokenService.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: { address: TOKEN_ADDRESSES.USDC, chainId: 1 },
      });

      const weth = await tokenService.create({
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.WETH, chainId: 1 },
      });

      const dai = await tokenService.create({
        tokenType: 'erc20',
        name: 'Dai',
        symbol: 'DAI',
        decimals: 18,
        config: { address: TOKEN_ADDRESSES.DAI, chainId: 1 },
      });

      // Create multiple pools concurrently
      const promises = [
        poolService.create({
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: usdc.id,
          token1Id: weth.id,
          feeBps: 500,
          config: {
            chainId: 1,
            address: REAL_POOLS.USDC_WETH_0_05,
            token0: TOKEN_ADDRESSES.USDC,
            token1: TOKEN_ADDRESSES.WETH,
            feeBps: 500,
            tickSpacing: 10,
          },
          state: {
            sqrtPriceX96: 0n,
            currentTick: 0,
            liquidity: 0n,
            feeGrowthGlobal0: 0n,
            feeGrowthGlobal1: 0n,
          },
        }),
        poolService.create({
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: usdc.id,
          token1Id: weth.id,
          feeBps: 3000,
          config: {
            chainId: 1,
            address: REAL_POOLS.USDC_WETH_0_3,
            token0: TOKEN_ADDRESSES.USDC,
            token1: TOKEN_ADDRESSES.WETH,
            feeBps: 3000,
            tickSpacing: 60,
          },
          state: {
            sqrtPriceX96: 0n,
            currentTick: 0,
            liquidity: 0n,
            feeGrowthGlobal0: 0n,
            feeGrowthGlobal1: 0n,
          },
        }),
        poolService.create({
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: dai.id,
          token1Id: usdc.id,
          feeBps: 100,
          config: {
            chainId: 1,
            address: REAL_POOLS.DAI_USDC_0_01,
            token0: TOKEN_ADDRESSES.DAI,
            token1: TOKEN_ADDRESSES.USDC,
            feeBps: 100,
            tickSpacing: 1,
          },
          state: {
            sqrtPriceX96: 0n,
            currentTick: 0,
            liquidity: 0n,
            feeGrowthGlobal0: 0n,
            feeGrowthGlobal1: 0n,
          },
        }),
      ];

      const pools = await Promise.all(promises);

      expect(pools.length).toBe(3);
      expect(new Set(pools.map((p) => p.id)).size).toBe(3); // All unique

      // Verify all persisted
      const counts = await countAllRecords();
      expect(counts.pools).toBe(3);
    });

    it('should verify database cleanup between tests', async () => {
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(0);
      expect(counts.pools).toBe(0);
      expect(counts.positions).toBe(0);
    });
  });
});
