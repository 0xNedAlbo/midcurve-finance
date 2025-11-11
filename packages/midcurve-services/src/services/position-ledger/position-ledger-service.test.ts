/**
 * Position Ledger Service Tests
 *
 * Unit tests for the abstract PositionLedgerService base class.
 * Uses a mock concrete implementation to test base functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import { PositionLedgerService } from './position-ledger-service.js';
import type {
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventState,
} from '@midcurve/shared';
import type { CreateUniswapV3LedgerEventInput } from '../types/position-ledger/position-ledger-event-input.js';
import {
  toEventConfig,
  toEventConfigDB,
  toEventState,
  toEventStateDB,
  type UniswapV3LedgerEventConfigDB,
  type UniswapV3LedgerEventStateDB,
} from '../types/uniswapv3/position-ledger-event-db.js';
import {
  INCREASE_POSITION_FIRST,
  DECREASE_POSITION_SECOND,
  COLLECT_THIRD,
} from './test-fixtures.js';

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

/**
 * Mock Uniswap V3 Position Ledger Service
 * Concrete implementation for testing abstract base class
 */
class MockUniswapV3PositionLedgerService extends PositionLedgerService<'uniswapv3'> {
  parseConfig(configDB: unknown): UniswapV3LedgerEventConfig {
    return toEventConfig(configDB as UniswapV3LedgerEventConfigDB);
  }

  serializeConfig(config: UniswapV3LedgerEventConfig): unknown {
    return toEventConfigDB(config);
  }

  parseState(stateDB: unknown): UniswapV3LedgerEventState {
    return toEventState(stateDB as UniswapV3LedgerEventStateDB);
  }

  serializeState(state: UniswapV3LedgerEventState): unknown {
    return toEventStateDB(state);
  }

  generateInputHash(input: CreateUniswapV3LedgerEventInput): string {
    // Simple mock hash generation
    const config = input.config;
    return `hash_${config.blockNumber}_${config.txIndex}_${config.logIndex}`;
  }

  async discoverAllEvents() {
    // Mock implementation - not tested in base service tests
    return [];
  }

  async discoverEvent() {
    // Mock implementation - not tested in base service tests
    return [];
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('PositionLedgerService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let service: MockUniswapV3PositionLedgerService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    service = new MockUniswapV3PositionLedgerService({ prisma: prismaMock });
  });

  // ==========================================================================
  // CONSTRUCTOR & DEPENDENCIES
  // ==========================================================================

  describe('Constructor', () => {
    it('should create service with default Prisma client', () => {
      const defaultService = new MockUniswapV3PositionLedgerService();
      expect(defaultService).toBeInstanceOf(PositionLedgerService);
    });

    it('should create service with injected Prisma client', () => {
      expect(service).toBeInstanceOf(PositionLedgerService);
      expect(service['_prisma']).toBe(prismaMock);
    });

    it('should create logger instance', () => {
      expect(service['logger']).toBeDefined();
      expect(typeof service['logger'].info).toBe('function');
      expect(typeof service['logger'].debug).toBe('function');
    });
  });

  // ==========================================================================
  // SERIALIZATION METHODS
  // ==========================================================================

  describe('Config Serialization', () => {
    it('should serialize config to database format', () => {
      const config = INCREASE_POSITION_FIRST.input.config;
      const serialized = service.serializeConfig(config);

      expect(serialized).toEqual(INCREASE_POSITION_FIRST.dbResult.config);
    });

    it('should parse config from database format', () => {
      const configDB = INCREASE_POSITION_FIRST.dbResult.config;
      const parsed = service.parseConfig(configDB);

      expect(parsed).toEqual(INCREASE_POSITION_FIRST.input.config);
    });

    it('should round-trip config serialization', () => {
      const original = INCREASE_POSITION_FIRST.input.config;
      const serialized = service.serializeConfig(original);
      const parsed = service.parseConfig(serialized);

      expect(parsed).toEqual(original);
    });
  });

  describe('State Serialization', () => {
    it('should serialize INCREASE_LIQUIDITY state to database format', () => {
      const state = INCREASE_POSITION_FIRST.input.state;
      const serialized = service.serializeState(state);

      expect(serialized).toEqual(INCREASE_POSITION_FIRST.dbResult.state);
    });

    it('should parse INCREASE_LIQUIDITY state from database format', () => {
      const stateDB = INCREASE_POSITION_FIRST.dbResult.state;
      const parsed = service.parseState(stateDB);

      expect(parsed).toEqual(INCREASE_POSITION_FIRST.input.state);
    });

    it('should serialize DECREASE_LIQUIDITY state to database format', () => {
      const state = DECREASE_POSITION_SECOND.input.state;
      const serialized = service.serializeState(state);

      expect(serialized).toEqual(DECREASE_POSITION_SECOND.dbResult.state);
    });

    it('should parse DECREASE_LIQUIDITY state from database format', () => {
      const stateDB = DECREASE_POSITION_SECOND.dbResult.state;
      const parsed = service.parseState(stateDB);

      expect(parsed).toEqual(DECREASE_POSITION_SECOND.input.state);
    });

    it('should serialize COLLECT state to database format', () => {
      const state = COLLECT_THIRD.input.state;
      const serialized = service.serializeState(state);

      expect(serialized).toEqual(COLLECT_THIRD.dbResult.state);
    });

    it('should parse COLLECT state from database format', () => {
      const stateDB = COLLECT_THIRD.dbResult.state;
      const parsed = service.parseState(stateDB);

      expect(parsed).toEqual(COLLECT_THIRD.input.state);
    });

    it('should round-trip state serialization for all event types', () => {
      const states = [
        INCREASE_POSITION_FIRST.input.state,
        DECREASE_POSITION_SECOND.input.state,
        COLLECT_THIRD.input.state,
      ];

      for (const original of states) {
        const serialized = service.serializeState(original);
        const parsed = service.parseState(serialized);
        expect(parsed).toEqual(original);
      }
    });
  });

  describe('Input Hash Generation', () => {
    it('should generate hash from blockchain coordinates', () => {
      const input = INCREASE_POSITION_FIRST.input;
      const hash = service.generateInputHash(input);

      expect(hash).toBe('hash_18000000_10_5');
    });

    it('should generate different hashes for different events', () => {
      const hash1 = service.generateInputHash(INCREASE_POSITION_FIRST.input);
      const hash2 = service.generateInputHash(DECREASE_POSITION_SECOND.input);

      expect(hash1).not.toBe(hash2);
    });
  });

  // ==========================================================================
  // VALIDATION METHODS
  // ==========================================================================

  describe('validateEventSequence', () => {
    it('should pass validation for first event (no previousId)', async () => {
      await expect(
        service['validateEventSequence']('position_001', null, 'uniswapv3')
      ).resolves.toBeUndefined();

      expect(prismaMock.positionLedgerEvent.findUnique).not.toHaveBeenCalled();
    });

    it('should pass validation when previous event exists and is valid', async () => {
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue({
        ...INCREASE_POSITION_FIRST.dbResult,
        id: 'event_001',
        positionId: 'position_001',
        protocol: 'uniswapv3',
      } as any);

      await expect(
        service['validateEventSequence']('position_001', 'event_001', 'uniswapv3')
      ).resolves.toBeUndefined();

      expect(prismaMock.positionLedgerEvent.findUnique).toHaveBeenCalledWith({
        where: { id: 'event_001' },
      });
    });

    it('should throw error when previous event not found', async () => {
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(null);

      await expect(
        service['validateEventSequence']('position_001', 'event_missing', 'uniswapv3')
      ).rejects.toThrow('Previous event event_missing not found');
    });

    it('should throw error when previous event belongs to different position', async () => {
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue({
        ...INCREASE_POSITION_FIRST.dbResult,
        id: 'event_001',
        positionId: 'position_other',
        protocol: 'uniswapv3',
      } as any);

      await expect(
        service['validateEventSequence']('position_001', 'event_001', 'uniswapv3')
      ).rejects.toThrow('belongs to position position_other');
    });

    it('should throw error when previous event is different protocol', async () => {
      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue({
        ...INCREASE_POSITION_FIRST.dbResult,
        id: 'event_001',
        positionId: 'position_001',
        protocol: 'orca',
      } as any);

      await expect(
        service['validateEventSequence']('position_001', 'event_001', 'uniswapv3')
      ).rejects.toThrow('is protocol orca, not uniswapv3');
    });
  });

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  describe('findAllItems', () => {
    it('should return empty array when no events exist', async () => {
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);

      const events = await service.findAllItems('position_001');

      expect(events).toEqual([]);
      expect(prismaMock.positionLedgerEvent.findMany).toHaveBeenCalledWith({
        where: {
          positionId: 'position_001',
          protocol: expect.any(String),
        },
        orderBy: {
          timestamp: 'desc',
        },
      });
    });

    it('should return events in descending order by timestamp', async () => {
      const dbResults = [
        COLLECT_THIRD.dbResult, // Newest first
        DECREASE_POSITION_SECOND.dbResult,
        INCREASE_POSITION_FIRST.dbResult,
      ];

      prismaMock.positionLedgerEvent.findMany.mockResolvedValue(dbResults as any);

      const events = await service.findAllItems('position_001');

      expect(events).toHaveLength(3);
      expect(events[0].eventType).toBe('COLLECT');
      expect(events[1].eventType).toBe('DECREASE_POSITION');
      expect(events[2].eventType).toBe('INCREASE_POSITION');
    });

    it('should correctly parse all event fields including bigints', async () => {
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        INCREASE_POSITION_FIRST.dbResult,
      ] as any);

      const events = await service.findAllItems('position_001');

      expect(events[0].poolPrice).toBe(2000_000000n);
      expect(events[0].token0Amount).toBe(500000000000000000n);
      expect(events[0].costBasisAfter).toBe(2000_000000n);
      expect(events[0].config.nftId).toBe(123456n);
      expect(events[0].state.liquidity).toBe(1000000n);
    });

    it('should correctly parse rewards array with bigints', async () => {
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        COLLECT_THIRD.dbResult,
      ] as any);

      const events = await service.findAllItems('position_001');

      expect(events[0].rewards).toHaveLength(2);
      expect(events[0].rewards[0].tokenAmount).toBe(10000000000000000n);
      expect(events[0].rewards[0].tokenValue).toBe(22_000000n);
    });
  });

  describe('addItem', () => {
    it('should add first event successfully', async () => {
      const input = INCREASE_POSITION_FIRST.input;
      const dbResult = INCREASE_POSITION_FIRST.dbResult;

      prismaMock.positionLedgerEvent.create.mockResolvedValue(dbResult as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([dbResult] as any);

      const events = await service.addItem('position_001', input);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('INCREASE_POSITION');

      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith({
        data: {
          positionId: 'position_001',
          protocol: 'uniswapv3',
          previousId: null,
          timestamp: input.timestamp,
          eventType: 'INCREASE_POSITION',
          inputHash: expect.any(String),
          poolPrice: input.poolPrice.toString(),
          token0Amount: input.token0Amount.toString(),
          token1Amount: input.token1Amount.toString(),
          tokenValue: input.tokenValue.toString(),
          rewards: [],
          deltaCostBasis: input.deltaCostBasis.toString(),
          costBasisAfter: input.costBasisAfter.toString(),
          deltaPnl: input.deltaPnl.toString(),
          pnlAfter: input.pnlAfter.toString(),
          config: expect.any(Object),
          state: expect.any(Object),
        },
      });
    });

    it('should add subsequent event with previousId', async () => {
      const input = DECREASE_POSITION_SECOND.input;
      const dbResult = DECREASE_POSITION_SECOND.dbResult;

      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(
        INCREASE_POSITION_FIRST.dbResult as any
      );
      prismaMock.positionLedgerEvent.create.mockResolvedValue(dbResult as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        dbResult,
        INCREASE_POSITION_FIRST.dbResult,
      ] as any);

      const events = await service.addItem('position_001', input);

      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe('DECREASE_POSITION');

      expect(prismaMock.positionLedgerEvent.findUnique).toHaveBeenCalledWith({
        where: { id: 'event_increase_001' },
      });
    });

    it('should serialize rewards correctly', async () => {
      const input = COLLECT_THIRD.input;
      const dbResult = COLLECT_THIRD.dbResult;

      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(
        DECREASE_POSITION_SECOND.dbResult as any
      );
      prismaMock.positionLedgerEvent.create.mockResolvedValue(dbResult as any);
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([dbResult] as any);

      await service.addItem('position_001', input);

      expect(prismaMock.positionLedgerEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rewards: [
            {
              tokenId: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              tokenAmount: '10000000000000000',
              tokenValue: '22000000',
            },
            {
              tokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              tokenAmount: '20000000',
              tokenValue: '20000000',
            },
          ],
        }),
      });
    });

    it('should throw error when validation fails', async () => {
      const input = DECREASE_POSITION_SECOND.input;

      prismaMock.positionLedgerEvent.findUnique.mockResolvedValue(null);

      await expect(service.addItem('position_001', input)).rejects.toThrow(
        'Previous event event_increase_001 not found'
      );

      expect(prismaMock.positionLedgerEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteAllItems', () => {
    it('should delete all events for position', async () => {
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 3 });

      await service.deleteAllItems('position_001');

      expect(prismaMock.positionLedgerEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          positionId: 'position_001',
          protocol: expect.any(String),
        },
      });
    });

    it('should be idempotent (succeed even when no events exist)', async () => {
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteAllItems('position_nonexistent')
      ).resolves.toBeUndefined();
    });

    it('should delete and log count of deleted events', async () => {
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 5 });

      await service.deleteAllItems('position_001');

      expect(prismaMock.positionLedgerEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          positionId: 'position_001',
          protocol: expect.any(String),
        },
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle events with zero liquidity', async () => {
      const zeroLiquidityEvent = {
        ...INCREASE_POSITION_FIRST.dbResult,
        config: {
          ...INCREASE_POSITION_FIRST.dbResult.config,
          liquidityAfter: '0',
        },
      };

      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        zeroLiquidityEvent,
      ] as any);

      const events = await service.findAllItems('position_001');

      expect(events[0].config.liquidityAfter).toBe(0n);
    });

    it('should handle events with empty rewards array', async () => {
      const noRewardsEvent = {
        ...INCREASE_POSITION_FIRST.dbResult,
        rewards: [],
      };

      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        noRewardsEvent,
      ] as any);

      const events = await service.findAllItems('position_001');

      expect(events[0].rewards).toEqual([]);
    });

    it('should handle negative deltaPnl (losses)', async () => {
      const lossEvent = {
        ...DECREASE_POSITION_SECOND.dbResult,
        deltaPnl: '-50000000', // -50 USDC loss
        pnlAfter: '-50000000',
      };

      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([lossEvent] as any);

      const events = await service.findAllItems('position_001');

      expect(events[0].deltaPnl).toBe(-50_000000n);
      expect(events[0].pnlAfter).toBe(-50_000000n);
    });

    it('should handle very large bigint values', async () => {
      const largeLiquidityEvent = {
        ...INCREASE_POSITION_FIRST.dbResult,
        config: {
          ...INCREASE_POSITION_FIRST.dbResult.config,
          liquidityAfter: '999999999999999999999999999999',
        },
      };

      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        largeLiquidityEvent,
      ] as any);

      const events = await service.findAllItems('position_001');

      expect(events[0].config.liquidityAfter).toBe(999999999999999999999999999999n);
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should propagate database errors from findAllItems', async () => {
      const dbError = new Error('Database connection lost');
      prismaMock.positionLedgerEvent.findMany.mockRejectedValue(dbError);

      await expect(service.findAllItems('position_001')).rejects.toThrow(
        'Database connection lost'
      );
    });

    it('should propagate database errors from addItem', async () => {
      const dbError = new Error('Unique constraint violation');
      prismaMock.positionLedgerEvent.create.mockRejectedValue(dbError);

      await expect(
        service.addItem('position_001', INCREASE_POSITION_FIRST.input)
      ).rejects.toThrow('Unique constraint violation');
    });

    it('should propagate database errors from deleteAllItems', async () => {
      const dbError = new Error('Permission denied');
      prismaMock.positionLedgerEvent.deleteMany.mockRejectedValue(dbError);

      await expect(service.deleteAllItems('position_001')).rejects.toThrow(
        'Permission denied'
      );
    });
  });
});
