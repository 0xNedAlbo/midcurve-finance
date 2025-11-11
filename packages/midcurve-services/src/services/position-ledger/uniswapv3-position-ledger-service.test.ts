/**
 * Unit tests for UniswapV3PositionLedgerService
 *
 * Comprehensive test coverage for:
 * - Constructor and dependency injection
 * - Serialization methods (config, state)
 * - Input hash generation
 * - Discovery methods (discoverAllEvents, discoverEvent)
 * - Financial calculations
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@midcurve/database';
import { UniswapV3PositionLedgerService } from './uniswapv3-position-ledger-service.js';
import type { EtherscanClient } from '../../clients/etherscan/index.js';
import type { RawPositionEvent } from '../../clients/etherscan/types.js';
import type { UniswapV3PositionService } from '../position/uniswapv3-position-service.js';
import type { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import type { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import {
  INCREASE_POSITION_FIRST,
  DECREASE_POSITION_SECOND,
  COLLECT_THIRD,
} from './test-fixtures.js';

describe('UniswapV3PositionLedgerService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let etherscanClientMock: DeepMockProxy<EtherscanClient>;
  let positionServiceMock: DeepMockProxy<UniswapV3PositionService>;
  let poolServiceMock: DeepMockProxy<UniswapV3PoolService>;
  let poolPriceServiceMock: DeepMockProxy<UniswapV3PoolPriceService>;
  let service: UniswapV3PositionLedgerService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    etherscanClientMock = mockDeep<EtherscanClient>();
    positionServiceMock = mockDeep<UniswapV3PositionService>();
    poolServiceMock = mockDeep<UniswapV3PoolService>();
    poolPriceServiceMock = mockDeep<UniswapV3PoolPriceService>();

    service = new UniswapV3PositionLedgerService({
      prisma: prismaMock,
      etherscanClient: etherscanClientMock,
      positionService: positionServiceMock,
      poolService: poolServiceMock,
      poolPriceService: poolPriceServiceMock,
    });
  });

  // ============================================================================
  // CONSTRUCTOR & DEPENDENCIES
  // ============================================================================

  describe('constructor', () => {
    it('should create instance with default dependencies', () => {
      // Service creation without dependencies should work (uses defaults)
      expect(() => new UniswapV3PositionLedgerService()).not.toThrow();
    });

    it('should create instance with custom dependencies', () => {
      const customService = new UniswapV3PositionLedgerService({
        prisma: prismaMock,
        etherscanClient: etherscanClientMock,
        positionService: positionServiceMock,
        poolService: poolServiceMock,
        poolPriceService: poolPriceServiceMock,
      });

      expect(customService).toBeInstanceOf(UniswapV3PositionLedgerService);
    });

    it('should inject all dependencies correctly', () => {
      expect(service['prisma']).toBe(prismaMock);
      expect(service['etherscanClient']).toBe(etherscanClientMock);
      expect(service['positionService']).toBe(positionServiceMock);
      expect(service['poolService']).toBe(poolServiceMock);
      expect(service['poolPriceService']).toBe(poolPriceServiceMock);
    });

    it('should have logger initialized', () => {
      expect(service['logger']).toBeDefined();
      expect(service['logger'].info).toBeDefined();
    });
  });

  // ============================================================================
  // SERIALIZATION METHODS
  // ============================================================================

  describe('serializeConfig', () => {
    it('should convert bigint values to strings', () => {
      const config = INCREASE_POSITION_FIRST.input.config;
      const serialized = service.serializeConfig(config);

      expect(serialized).toMatchObject({
        chainId: config.chainId,
        nftId: config.nftId.toString(),
        blockNumber: config.blockNumber.toString(),
        txIndex: config.txIndex,
        logIndex: config.logIndex,
        txHash: config.txHash,
        deltaL: config.deltaL.toString(),
        liquidityAfter: config.liquidityAfter.toString(),
        feesCollected0: config.feesCollected0.toString(),
        feesCollected1: config.feesCollected1.toString(),
        uncollectedPrincipal0After: config.uncollectedPrincipal0After.toString(),
        uncollectedPrincipal1After: config.uncollectedPrincipal1After.toString(),
        sqrtPriceX96: config.sqrtPriceX96.toString(),
      });
    });

    it('should handle zero bigint values', () => {
      const config = {
        ...INCREASE_POSITION_FIRST.input.config,
        deltaL: 0n,
        liquidityAfter: 0n,
        feesCollected0: 0n,
        feesCollected1: 0n,
      };

      const serialized = service.serializeConfig(config);

      expect(serialized).toMatchObject({
        deltaL: '0',
        liquidityAfter: '0',
        feesCollected0: '0',
        feesCollected1: '0',
      });
    });
  });

  describe('parseConfig', () => {
    it('should convert string values to bigint', () => {
      const configDB = {
        chainId: 1,
        nftId: '123456',
        blockNumber: '18000000',
        txIndex: 10,
        logIndex: 5,
        txHash: '0x123',
        deltaL: '1000000',
        liquidityAfter: '1000000',
        feesCollected0: '0',
        feesCollected1: '0',
        uncollectedPrincipal0After: '0',
        uncollectedPrincipal1After: '0',
        sqrtPriceX96: '1234567890',
      };

      const parsed = service.parseConfig(configDB);

      expect(parsed.chainId).toBe(1);
      expect(parsed.nftId).toBe(123456n);
      expect(parsed.blockNumber).toBe(18000000n);
      expect(parsed.deltaL).toBe(1000000n);
      expect(parsed.liquidityAfter).toBe(1000000n);
      expect(parsed.sqrtPriceX96).toBe(1234567890n);
    });
  });

  describe('config round-trip', () => {
    it('should preserve values through serialize → parse cycle', () => {
      const original = INCREASE_POSITION_FIRST.input.config;
      const serialized = service.serializeConfig(original);
      const parsed = service.parseConfig(serialized);

      expect(parsed).toEqual(original);
    });
  });

  describe('serializeState - INCREASE_LIQUIDITY', () => {
    it('should serialize INCREASE_LIQUIDITY state', () => {
      const state = INCREASE_POSITION_FIRST.input.state;
      const serialized = service.serializeState(state);

      expect(serialized).toMatchObject({
        eventType: 'INCREASE_LIQUIDITY',
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      });
    });
  });

  describe('serializeState - DECREASE_LIQUIDITY', () => {
    it('should serialize DECREASE_LIQUIDITY state', () => {
      const state = DECREASE_POSITION_SECOND.input.state;
      const serialized = service.serializeState(state);

      expect(serialized).toMatchObject({
        eventType: 'DECREASE_LIQUIDITY',
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      });
    });
  });

  describe('serializeState - COLLECT', () => {
    it('should serialize COLLECT state', () => {
      const state = COLLECT_THIRD.input.state;
      const serialized = service.serializeState(state);

      expect(serialized).toMatchObject({
        eventType: 'COLLECT',
        recipient: state.recipient,
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      });
    });
  });

  describe('parseState', () => {
    it('should parse INCREASE_LIQUIDITY state', () => {
      const stateDB = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      const parsed = service.parseState(stateDB);

      expect(parsed.eventType).toBe('INCREASE_LIQUIDITY');
      expect(parsed.tokenId).toBe(123456n);
      expect(parsed.liquidity).toBe(1000000n);
      expect(parsed.amount0).toBe(500000000000000000n);
      expect(parsed.amount1).toBe(1000000000n);
    });

    it('should parse DECREASE_LIQUIDITY state', () => {
      const stateDB = {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: '123456',
        liquidity: '500000',
        amount0: '250000000000000000',
        amount1: '500000000',
      };

      const parsed = service.parseState(stateDB);

      expect(parsed.eventType).toBe('DECREASE_LIQUIDITY');
      expect(parsed.tokenId).toBe(123456n);
      expect(parsed.liquidity).toBe(500000n);
    });

    it('should parse COLLECT state', () => {
      const stateDB = {
        eventType: 'COLLECT',
        tokenId: '123456',
        recipient: '0x1234567890123456789012345678901234567890',
        amount0: '100000000000000',
        amount1: '200000',
      };

      const parsed = service.parseState(stateDB);

      expect(parsed.eventType).toBe('COLLECT');
      expect(parsed.tokenId).toBe(123456n);
      expect(parsed.recipient).toBe('0x1234567890123456789012345678901234567890');
      expect(parsed.amount0).toBe(100000000000000n);
      expect(parsed.amount1).toBe(200000n);
    });
  });

  describe('state round-trip', () => {
    it('should preserve INCREASE state through serialize → parse cycle', () => {
      const original = INCREASE_POSITION_FIRST.input.state;
      const serialized = service.serializeState(original);
      const parsed = service.parseState(serialized);

      expect(parsed).toEqual(original);
    });

    it('should preserve DECREASE state through serialize → parse cycle', () => {
      const original = DECREASE_POSITION_SECOND.input.state;
      const serialized = service.serializeState(original);
      const parsed = service.parseState(serialized);

      expect(parsed).toEqual(original);
    });

    it('should preserve COLLECT state through serialize → parse cycle', () => {
      const original = COLLECT_THIRD.input.state;
      const serialized = service.serializeState(original);
      const parsed = service.parseState(serialized);

      expect(parsed).toEqual(original);
    });
  });

  // ============================================================================
  // INPUT HASH GENERATION
  // ============================================================================

  describe('generateInputHash', () => {
    it('should generate deterministic hash from blockchain coordinates', () => {
      const input = INCREASE_POSITION_FIRST.input;
      const hash1 = service.generateInputHash(input);
      const hash2 = service.generateInputHash(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32); // MD5 hex digest
      expect(hash1).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should generate different hashes for different block numbers', () => {
      const input1 = INCREASE_POSITION_FIRST.input;
      const input2 = {
        ...INCREASE_POSITION_FIRST.input,
        config: {
          ...INCREASE_POSITION_FIRST.input.config,
          blockNumber: 18000001n,
        },
      };

      const hash1 = service.generateInputHash(input1);
      const hash2 = service.generateInputHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for different transaction indexes', () => {
      const input1 = INCREASE_POSITION_FIRST.input;
      const input2 = {
        ...INCREASE_POSITION_FIRST.input,
        config: {
          ...INCREASE_POSITION_FIRST.input.config,
          txIndex: 11,
        },
      };

      const hash1 = service.generateInputHash(input1);
      const hash2 = service.generateInputHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for different log indexes', () => {
      const input1 = INCREASE_POSITION_FIRST.input;
      const input2 = {
        ...INCREASE_POSITION_FIRST.input,
        config: {
          ...INCREASE_POSITION_FIRST.input.config,
          logIndex: 6,
        },
      };

      const hash1 = service.generateInputHash(input1);
      const hash2 = service.generateInputHash(input2);

      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================================================
  // DISCOVERY - discoverAllEvents
  // ============================================================================

  describe('discoverAllEvents', () => {
    const positionId = 'position_001';
    const poolId = 'pool_001';
    const token0Id = 'token_weth';
    const token1Id = 'token_usdc';

    const mockPosition = {
      id: positionId,
      protocol: 'uniswapv3',
      poolId,
      config: {
        nftId: 123456,
        chainId: 1,
      },
    };

    const mockPool = {
      id: poolId,
      protocol: 'uniswapv3',
      token0Id,
      token1Id,
      token0: {
        id: token0Id,
        decimals: 18,
        symbol: 'WETH',
      },
      token1: {
        id: token1Id,
        decimals: 6,
        symbol: 'USDC',
      },
    };

    const mockPoolPrice = {
      id: 'price_001',
      poolId,
      timestamp: new Date('2024-01-01'),
      state: {
        sqrtPriceX96: 1771595571142957166275370187392n, // ~2000 USDC per WETH
      },
    };

    beforeEach(() => {
      // Mock position fetch
      prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);

      // Mock pool fetch
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

      // Mock pool price discovery
      poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice as any);

      // Mock deleteMany for cleanup
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock findMany for returning events
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
    });

    it('should return empty array when no events found', async () => {
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      const result = await service.discoverAllEvents(positionId);

      expect(result).toEqual([]);
      expect(etherscanClientMock.fetchPositionEvents).toHaveBeenCalledWith(
        1,
        '123456'
      );
    });

    it('should fetch position data and delete existing events', async () => {
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      await service.discoverAllEvents(positionId);

      expect(prismaMock.position.findUnique).toHaveBeenCalledWith({
        where: { id: positionId },
        include: { pool: true },
      });
      expect(prismaMock.positionLedgerEvent.deleteMany).toHaveBeenCalled();
    });

    it('should fetch pool metadata with tokens', async () => {
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      await service.discoverAllEvents(positionId);

      expect(prismaMock.pool.findUnique).toHaveBeenCalledWith({
        where: { id: poolId },
        include: {
          token0: true,
          token1: true,
        },
      });
    });

    it('should discover historic pool price for each event', async () => {
      const rawEvent: RawPositionEvent = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x123',
        blockNumber: 18000000n,
        transactionIndex: 10,
        logIndex: 5,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      etherscanClientMock.fetchPositionEvents.mockResolvedValue([rawEvent]);
      prismaMock.positionLedgerEvent.create.mockResolvedValue({
        id: 'event_001',
        ...INCREASE_POSITION_FIRST.dbResult,
      } as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        {
          id: 'event_001',
          ...INCREASE_POSITION_FIRST.dbResult,
        } as any,
      ]);

      await service.discoverAllEvents(positionId);

      expect(poolPriceServiceMock.discover).toHaveBeenCalledWith(poolId, {
        blockNumber: 18000000,
      });
    });

    it('should process INCREASE_LIQUIDITY event correctly', async () => {
      const rawEvent: RawPositionEvent = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x123',
        blockNumber: 18000000n,
        transactionIndex: 10,
        logIndex: 5,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      etherscanClientMock.fetchPositionEvents.mockResolvedValue([rawEvent]);
      prismaMock.positionLedgerEvent.create.mockResolvedValue({
        id: 'event_001',
        ...INCREASE_POSITION_FIRST.dbResult,
      } as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        {
          id: 'event_001',
          ...INCREASE_POSITION_FIRST.dbResult,
        } as any,
      ]);

      const result = await service.discoverAllEvents(positionId);

      expect(result).toHaveLength(1);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'INCREASE_POSITION',
            positionId,
            protocol: 'uniswapv3',
            previousId: null, // First event
          }),
        })
      );
    });

    it('should process DECREASE_LIQUIDITY event with PnL calculation', async () => {
      const increaseEvent: RawPositionEvent = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x123',
        blockNumber: 18000000n,
        transactionIndex: 10,
        logIndex: 5,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      const decreaseEvent: RawPositionEvent = {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x124',
        blockNumber: 18000100n,
        transactionIndex: 15,
        logIndex: 3,
        blockTimestamp: new Date('2024-01-02'),
        chainId: 1,
        liquidity: '500000',
        amount0: '250000000000000000',
        amount1: '500000000',
      };

      etherscanClientMock.fetchPositionEvents.mockResolvedValue([
        increaseEvent,
        decreaseEvent,
      ]);

      let eventCount = 0;
      prismaMock.positionLedgerEvent.create.mockImplementation(async () => {
        eventCount++;
        return {
          id: `event_${eventCount.toString().padStart(3, '0')}`,
          ...(eventCount === 1
            ? INCREASE_POSITION_FIRST.dbResult
            : DECREASE_POSITION_SECOND.dbResult),
        } as any;
      });

      // Mock findUnique for validating previous event
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue({
        id: 'event_001',
        positionId,
        protocol: 'uniswapv3',
        ...INCREASE_POSITION_FIRST.dbResult,
      } as any);

      // Mock findMany for:
      // 1. First addItem call (returns first event)
      // 2. Second addItem call (returns both events)
      // 3. APR service calculateAprPeriods (returns both events)
      // 4. Final findAllItems call (returns both events)
      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...DECREASE_POSITION_SECOND.dbResult,
          } as any,
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...DECREASE_POSITION_SECOND.dbResult,
          } as any,
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...DECREASE_POSITION_SECOND.dbResult,
          } as any,
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ]);

      const result = await service.discoverAllEvents(positionId);

      expect(result).toHaveLength(2);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledTimes(2);
    });

    it('should process COLLECT event with fee separation', async () => {
      const collectEvent: RawPositionEvent = {
        eventType: 'COLLECT',
        tokenId: '123456',
        transactionHash: '0x125',
        blockNumber: 18000200n,
        transactionIndex: 20,
        logIndex: 7,
        blockTimestamp: new Date('2024-01-03'),
        chainId: 1,
        amount0: '100000000000000',
        amount1: '200000',
        recipient: '0x1234567890123456789012345678901234567890',
      };

      etherscanClientMock.fetchPositionEvents.mockResolvedValue([collectEvent]);
      prismaMock.positionLedgerEvent.create.mockResolvedValue({
        id: 'event_001',
        ...COLLECT_THIRD.dbResult,
      } as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        {
          id: 'event_001',
          ...COLLECT_THIRD.dbResult,
        } as any,
      ]);

      const result = await service.discoverAllEvents(positionId);

      expect(result).toHaveLength(1);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'COLLECT',
          }),
        })
      );
    });

    it('should sort events chronologically before processing', async () => {
      const event1: RawPositionEvent = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x123',
        blockNumber: 18000000n,
        transactionIndex: 10,
        logIndex: 5,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      const event2: RawPositionEvent = {
        eventType: 'COLLECT',
        tokenId: '123456',
        transactionHash: '0x124',
        blockNumber: 18000100n,
        transactionIndex: 5,
        logIndex: 2,
        blockTimestamp: new Date('2024-01-02'),
        chainId: 1,
        amount0: '100000000000000',
        amount1: '200000',
        recipient: '0x1234567890123456789012345678901234567890',
      };

      // Return events in wrong order
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([event2, event1]);

      let eventCount = 0;
      prismaMock.positionLedgerEvent.create.mockImplementation(async () => {
        eventCount++;
        return {
          id: `event_${eventCount.toString().padStart(3, '0')}`,
          ...(eventCount === 1
            ? INCREASE_POSITION_FIRST.dbResult
            : COLLECT_THIRD.dbResult),
        } as any;
      });

      // Mock findUnique for validating previous event
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue({
        id: 'event_001',
        positionId,
        protocol: 'uniswapv3',
        ...INCREASE_POSITION_FIRST.dbResult,
      } as any);

      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...COLLECT_THIRD.dbResult,
          } as any,
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ]);

      await service.discoverAllEvents(positionId);

      // Verify first create call was for INCREASE (block 18000000)
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'INCREASE_POSITION',
          }),
        })
      );

      // Verify second create call was for COLLECT (block 18000100)
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'COLLECT',
          }),
        })
      );
    });

    it('should handle multiple events in same block (ordered by txIndex, logIndex)', async () => {
      const event1: RawPositionEvent = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x123',
        blockNumber: 18000000n,
        transactionIndex: 10,
        logIndex: 5,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      const event2: RawPositionEvent = {
        eventType: 'COLLECT',
        tokenId: '123456',
        transactionHash: '0x124',
        blockNumber: 18000000n, // Same block
        transactionIndex: 15, // Later tx
        logIndex: 2,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        amount0: '100000000000000',
        amount1: '200000',
        recipient: '0x1234567890123456789012345678901234567890',
      };

      etherscanClientMock.fetchPositionEvents.mockResolvedValue([event2, event1]);

      let eventCount = 0;
      prismaMock.positionLedgerEvent.create.mockImplementation(async () => {
        eventCount++;
        return {
          id: `event_${eventCount.toString().padStart(3, '0')}`,
          ...(eventCount === 1
            ? INCREASE_POSITION_FIRST.dbResult
            : COLLECT_THIRD.dbResult),
        } as any;
      });

      // Mock findUnique for validating previous event
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue({
        id: 'event_001',
        positionId,
        protocol: 'uniswapv3',
        ...INCREASE_POSITION_FIRST.dbResult,
      } as any);

      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...COLLECT_THIRD.dbResult,
          } as any,
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ]);

      await service.discoverAllEvents(positionId);

      // Event 1 should be processed first (txIndex 10 < 15)
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            config: expect.objectContaining({
              txIndex: 10,
            }),
          }),
        })
      );
    });

    it('should throw error if position not found', async () => {
      prismaMock.position.findUnique.mockResolvedValue(null);

      await expect(service.discoverAllEvents(positionId)).rejects.toThrow(
        'Position not found'
      );
    });

    it('should throw error if position is not uniswapv3', async () => {
      prismaMock.position.findUnique.mockResolvedValue({
        ...mockPosition,
        protocol: 'orca',
      } as any);

      await expect(service.discoverAllEvents(positionId)).rejects.toThrow(
        "Invalid position protocol 'orca'"
      );
    });

    it('should throw error if pool not found', async () => {
      prismaMock.pool.findUnique.mockResolvedValue(null);
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      await expect(service.discoverAllEvents(positionId)).rejects.toThrow(
        'Pool not found'
      );
    });

    it('should throw error if pool tokens not found', async () => {
      prismaMock.pool.findUnique.mockResolvedValue({
        ...mockPool,
        token0: null,
      } as any);
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      await expect(service.discoverAllEvents(positionId)).rejects.toThrow(
        'Pool tokens not found'
      );
    });

    it('should handle Etherscan API failure', async () => {
      etherscanClientMock.fetchPositionEvents.mockRejectedValue(
        new Error('Etherscan API error')
      );

      await expect(service.discoverAllEvents(positionId)).rejects.toThrow(
        'Etherscan API error'
      );
    });

    it('should handle pool price discovery failure', async () => {
      const rawEvent: RawPositionEvent = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        transactionHash: '0x123',
        blockNumber: 18000000n,
        transactionIndex: 10,
        logIndex: 5,
        blockTimestamp: new Date('2024-01-01'),
        chainId: 1,
        liquidity: '1000000',
        amount0: '500000000000000000',
        amount1: '1000000000',
      };

      etherscanClientMock.fetchPositionEvents.mockResolvedValue([rawEvent]);
      poolPriceServiceMock.discover.mockRejectedValue(
        new Error('Pool price discovery failed')
      );

      await expect(service.discoverAllEvents(positionId)).rejects.toThrow(
        'Pool price discovery failed'
      );
    });
  });

  // ============================================================================
  // DISCOVERY - discoverEvent
  // ============================================================================

  describe('discoverEvent', () => {
    const positionId = 'position_001';
    const poolId = 'pool_001';

    const mockPosition = {
      id: positionId,
      protocol: 'uniswapv3',
      poolId,
      config: {
        nftId: 123456,
        chainId: 1,
      },
    };

    const mockPool = {
      id: poolId,
      protocol: 'uniswapv3',
      token0: {
        id: 'token_weth',
        decimals: 18,
      },
      token1: {
        id: 'token_usdc',
        decimals: 6,
      },
    };

    const mockPoolPrice = {
      id: 'price_001',
      poolId,
      timestamp: new Date('2024-01-01'),
      state: {
        sqrtPriceX96: 1771595571142957166275370187392n,
      },
    };

    const mockDiscoverInput: any = {
      eventType: 'INCREASE_LIQUIDITY',
      blockNumber: 18000000n,
      transactionIndex: 10,
      logIndex: 5,
      transactionHash: '0x123',
      timestamp: new Date('2024-01-01'),
      tokenId: 123456n,
      liquidity: 1000000n,
      amount0: 500000000000000000n,
      amount1: 1000000000n,
    };

    beforeEach(() => {
      prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);
      prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);
      poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.create.mockResolvedValue({
        id: 'event_001',
        ...INCREASE_POSITION_FIRST.dbResult,
      } as any);
    });

    it('should add first event (no previous events)', async () => {
      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([]) // No existing events
        .mockResolvedValueOnce([
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ]);

      const result = await service.discoverEvent(positionId, mockDiscoverInput);

      expect(result).toHaveLength(1);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousId: null, // First event
          }),
        })
      );
    });

    it('should add event after existing event', async () => {
      const lastEvent = {
        id: 'event_increase_001',
        positionId,
        protocol: 'uniswapv3',
        ...INCREASE_POSITION_FIRST.dbResult,
        timestamp: new Date('2023-12-31'),
      };

      // Mock findUnique for validating previous event
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(lastEvent as any);

      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([lastEvent as any])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
          lastEvent as any,
        ]);

      const result = await service.discoverEvent(positionId, mockDiscoverInput);

      expect(result).toHaveLength(2);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousId: 'event_increase_001',
          }),
        })
      );
    });

    it('should throw error if NFT ID mismatch', async () => {
      const wrongNftInput = {
        ...mockDiscoverInput,
        tokenId: 999999n,
      };

      await expect(
        service.discoverEvent(positionId, wrongNftInput)
      ).rejects.toThrow('NFT ID mismatch');
    });

    it('should throw error if event timestamp is before last event', async () => {
      const lastEvent = {
        id: 'event_001',
        ...INCREASE_POSITION_FIRST.dbResult,
        timestamp: new Date('2024-01-02'), // After new event
      };

      prismaMock.positionLedgerEvent.findMany.mockResolvedValueOnce([lastEvent as any]);

      await expect(
        service.discoverEvent(positionId, mockDiscoverInput)
      ).rejects.toThrow('must be after last event');
    });

    it('should discover historic pool price for event block', async () => {
      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'event_001',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
        ]);

      await service.discoverEvent(positionId, mockDiscoverInput);

      expect(poolPriceServiceMock.discover).toHaveBeenCalledWith(poolId, {
        blockNumber: 18000000,
      });
    });

    it('should use previous state for financial calculations', async () => {
      const lastEvent = {
        id: 'event_increase_001',
        ...INCREASE_POSITION_FIRST.dbResult,
        timestamp: new Date('2023-12-31'),
        costBasisAfter: '2000000000',
        pnlAfter: '0',
        config: {
          ...INCREASE_POSITION_FIRST.dbResult.config,
          liquidityAfter: '1000000',
          uncollectedPrincipal0After: '0',
          uncollectedPrincipal1After: '0',
        },
      };

      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([lastEvent as any])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...INCREASE_POSITION_FIRST.dbResult,
          } as any,
          lastEvent as any,
        ]);

      // Mock findUnique for validating previous event
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(lastEvent as any);

      await service.discoverEvent(positionId, mockDiscoverInput);

      // Verify create was called (state was used for calculation)
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalled();
    });

    it('should handle DECREASE event with PnL calculation', async () => {
      const decreaseInput: any = {
        eventType: 'DECREASE_LIQUIDITY',
        blockNumber: 18000100n,
        transactionIndex: 15,
        logIndex: 3,
        transactionHash: '0x124',
        timestamp: new Date('2024-01-02'),
        tokenId: 123456n,
        liquidity: 500000n,
        amount0: 250000000000000000n,
        amount1: 500000000n,
      };

      const lastEvent = {
        id: 'event_increase_001',
        ...INCREASE_POSITION_FIRST.dbResult,
        timestamp: new Date('2024-01-01'),
      };

      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([lastEvent as any])
        .mockResolvedValueOnce([
          {
            id: 'event_002',
            ...DECREASE_POSITION_SECOND.dbResult,
          } as any,
          lastEvent as any,
        ]);

      // Mock findUnique for validating previous event
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(lastEvent as any);

      const result = await service.discoverEvent(positionId, decreaseInput);

      expect(result).toHaveLength(2);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'DECREASE_POSITION',
          }),
        })
      );
    });

    it('should handle COLLECT event with fee separation', async () => {
      const collectInput: any = {
        eventType: 'COLLECT',
        blockNumber: 18000200n,
        transactionIndex: 20,
        logIndex: 7,
        transactionHash: '0x125',
        timestamp: new Date('2024-01-03'),
        tokenId: 123456n,
        amount0: 100000000000000n,
        amount1: 200000n,
        recipient: '0x1234567890123456789012345678901234567890',
      };

      prismaMock.positionLedgerEvent.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'event_001',
            ...COLLECT_THIRD.dbResult,
          } as any,
        ]);

      const result = await service.discoverEvent(positionId, collectInput);

      expect(result).toHaveLength(1);
      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'COLLECT',
          }),
        })
      );
    });
  });

  // ============================================================================
  // EDGE CASES & ERROR HANDLING
  // ============================================================================

  describe('edge cases', () => {
    it('should handle zero liquidity events', () => {
      const input = {
        ...INCREASE_POSITION_FIRST.input,
        config: {
          ...INCREASE_POSITION_FIRST.input.config,
          deltaL: 0n,
        },
        state: {
          ...INCREASE_POSITION_FIRST.input.state,
          liquidity: 0n,
        },
      };

      expect(() => service.generateInputHash(input)).not.toThrow();
    });

    it('should handle large BigInt values', () => {
      const input = {
        ...INCREASE_POSITION_FIRST.input,
        config: {
          ...INCREASE_POSITION_FIRST.input.config,
          sqrtPriceX96: 9999999999999999999999999999999999n,
        },
      };

      const hash = service.generateInputHash(input);
      expect(hash).toBeDefined();
    });

    it('should handle zero fee collects', () => {
      const input = {
        ...COLLECT_THIRD.input,
        config: {
          ...COLLECT_THIRD.input.config,
          feesCollected0: 0n,
          feesCollected1: 0n,
        },
      };

      const serialized = service.serializeConfig(input.config);
      expect(serialized).toMatchObject({
        feesCollected0: '0',
        feesCollected1: '0',
      });
    });

    it('should handle negative PnL (losses)', () => {
      const input = {
        ...DECREASE_POSITION_SECOND.input,
        deltaPnl: -500000000n, // Loss
        pnlAfter: -500000000n,
      };

      // Should not throw on negative values
      expect(input.deltaPnl).toBeLessThan(0n);
      expect(input.pnlAfter).toBeLessThan(0n);
    });
  });
});
