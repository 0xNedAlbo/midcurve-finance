/**
 * Unit tests for ledger sync orchestration
 *
 * Tests for syncLedgerEvents and related helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import {
  syncLedgerEvents,
  type SyncLedgerEventsParams,
  type LedgerSyncDependencies,
} from './ledger-sync.js';
import type { EtherscanClient } from '../../../../clients/etherscan/index.js';
import type { EvmBlockService } from '../../../block/evm-block-service.js';
import type { PositionAprService } from '../../../position-apr/position-apr-service.js';
import type { UniswapV3PositionLedgerService } from '../../uniswapv3-position-ledger-service.js';
import type { UniswapV3PoolPriceService } from '../../../pool-price/uniswapv3-pool-price-service.js';
import type { RawPositionEvent } from '../../../../clients/etherscan/types.js';

describe('syncLedgerEvents', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let etherscanClientMock: DeepMockProxy<EtherscanClient>;
  let evmBlockServiceMock: DeepMockProxy<EvmBlockService>;
  let aprServiceMock: DeepMockProxy<PositionAprService>;
  let ledgerServiceMock: DeepMockProxy<UniswapV3PositionLedgerService>;
  let poolPriceServiceMock: DeepMockProxy<UniswapV3PoolPriceService>;
  const logger = pino({ level: 'silent' });

  let deps: LedgerSyncDependencies;
  let params: SyncLedgerEventsParams;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    etherscanClientMock = mockDeep<EtherscanClient>();
    evmBlockServiceMock = mockDeep<EvmBlockService>();
    aprServiceMock = mockDeep<PositionAprService>();
    ledgerServiceMock = mockDeep<UniswapV3PositionLedgerService>();
    poolPriceServiceMock = mockDeep<UniswapV3PoolPriceService>();

    mockReset(prismaMock);
    mockReset(etherscanClientMock);
    mockReset(evmBlockServiceMock);
    mockReset(aprServiceMock);
    mockReset(ledgerServiceMock);
    mockReset(poolPriceServiceMock);

    // Mock positionSyncState table operations
    prismaMock.positionSyncState.findUnique.mockResolvedValue(null);
    prismaMock.positionSyncState.create.mockResolvedValue({
      id: 'sync_state_123',
      positionId: 'pos_123',
      state: { missingEvents: [] },
      lastSyncAt: new Date(),
      lastSyncBy: 'ledger-sync',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    prismaMock.positionSyncState.update.mockResolvedValue({
      id: 'sync_state_123',
      positionId: 'pos_123',
      state: { missingEvents: [] },
      lastSyncAt: new Date(),
      lastSyncBy: 'ledger-sync',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    deps = {
      prisma: prismaMock,
      etherscanClient: etherscanClientMock,
      evmBlockService: evmBlockServiceMock,
      aprService: aprServiceMock,
      ledgerService: ledgerServiceMock,
      poolPriceService: poolPriceServiceMock,
      logger,
    };

    params = {
      positionId: 'pos_123',
      chainId: 1,
      nftId: 123n,
    };
  });

  describe('basic flow', () => {
    it('should handle no new events gracefully', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(1000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(params, deps);

      expect(result.eventsAdded).toBe(0);
      expect(result.finalizedBlock).toBe(1000n);
      expect(result.fromBlock).toBeGreaterThan(0n); // NFPM deployment block
      expect(aprServiceMock.refresh).toHaveBeenCalledWith('pos_123');
    });

    it('should throw error if finalized block is null', async () => {
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(null);

      await expect(syncLedgerEvents(params, deps)).rejects.toThrow(
        'Failed to retrieve finalized block number for chain 1'
      );
    });

    it('should throw error if finalized block is undefined', async () => {
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(undefined as any);

      await expect(syncLedgerEvents(params, deps)).rejects.toThrow(
        'Failed to retrieve finalized block number for chain 1'
      );
    });
  });

  describe('incremental sync', () => {
    it('should sync from last event block when events exist', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock existing event at block 1500
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue({
        config: { blockNumber: '1500' },
      } as any);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no new events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(params, deps);

      expect(result.fromBlock).toBe(1500n); // Should start from last event block
      expect(etherscanClientMock.fetchPositionEvents).toHaveBeenCalledWith(
        1,
        '123',
        {
          fromBlock: '1500',
          toBlock: '2000',
        }
      );
    });

    it('should sync from NFPM deployment when no events exist', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(params, deps);

      // When no events exist, fromBlock = MIN(NFPM deployment, finalized block)
      // In this case: MIN(12369621, 2000) = 2000
      expect(result.fromBlock).toBe(2000n);
    });
  });

  describe('full resync', () => {
    it('should sync from NFPM deployment when forceFullResync is true', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock existing event at block 1500 (should be ignored)
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue({
        config: { blockNumber: '1500' },
      } as any);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(
        { ...params, forceFullResync: true },
        deps
      );

      // Should start from NFPM deployment, not last event
      expect(result.fromBlock).toBe(12369621n); // Ethereum NFPM deployment
    });
  });

  describe('event deletion', () => {
    it('should delete events >= fromBlock', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock existing event at block 1500
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue({
        config: { blockNumber: '1500' },
      } as any);

      // Mock 3 events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        { id: 'evt_1' },
        { id: 'evt_2' },
        { id: 'evt_3' },
      ] as any);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 3 });

      // Mock Etherscan returning no new events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      await syncLedgerEvents(params, deps);

      // Verify deletion query
      expect(prismaMock.positionLedgerEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          positionId: 'pos_123',
          config: {
            path: ['blockNumber'],
            gte: '1500',
          },
        },
      });
    });
  });

  describe('event processing', () => {
    it('should process and save new events', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning 2 events
      const mockRawEvents: Partial<RawPositionEvent>[] = [
        {
          eventType: 'INCREASE_LIQUIDITY',
          blockNumber: 1800n,
          transactionIndex: 10,
          logIndex: 5,
          transactionHash: '0xabc',
          timestamp: new Date('2024-01-01'),
          amount0: 1000000000000000000n,
          amount1: 2000000000n,
          liquidity: 1000000000000000n,
          tokenId: 123n,
        },
        {
          eventType: 'COLLECT',
          blockNumber: 1900n,
          transactionIndex: 20,
          logIndex: 8,
          transactionHash: '0xdef',
          timestamp: new Date('2024-01-02'),
          amount0: 50000000000000000n,
          amount1: 100000000n,
          tokenId: 123n,
        },
      ];
      etherscanClientMock.fetchPositionEvents.mockResolvedValue(
        mockRawEvents as RawPositionEvent[]
      );

      // Mock position fetch (for processAndSaveEvents)
      prismaMock.position.findUnique.mockResolvedValue({
        id: 'pos_123',
        poolId: 'pool_456',
      } as any);

      // Mock pool metadata fetch (with tokens included)
      prismaMock.pool.findUnique.mockResolvedValue({
        id: 'pool_456',
        token0Id: 'token_0',
        token1Id: 'token_1',
        config: { token0IsQuote: true },
        token0: {
          id: 'token_0',
          decimals: 18,
        },
        token1: {
          id: 'token_1',
          decimals: 6,
        },
      } as any);

      // Mock ledger service (no existing events, then save events)
      ledgerServiceMock.findAllItems.mockResolvedValue([]);
      ledgerServiceMock.addItem.mockResolvedValue([
        { id: 'evt_new' } as any,
      ]);

      // Mock pool price service
      poolPriceServiceMock.discover.mockResolvedValue({
        state: {
          sqrtPriceX96: 79228162514264337593543950336n,
        },
        timestamp: new Date(),
      } as any);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(params, deps);

      expect(result.eventsAdded).toBe(2);
      expect(ledgerServiceMock.addItem).toHaveBeenCalledTimes(2);
      expect(aprServiceMock.refresh).toHaveBeenCalledWith('pos_123');
    });

    it('should handle processing error gracefully', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning 1 event
      const mockRawEvents: Partial<RawPositionEvent>[] = [
        {
          eventType: 'INCREASE_LIQUIDITY',
          blockNumber: 1800n,
          transactionIndex: 10,
          logIndex: 5,
          transactionHash: '0xabc',
          amount0: 1000000000000000000n,
          amount1: 2000000000n,
        },
      ];
      etherscanClientMock.fetchPositionEvents.mockResolvedValue(
        mockRawEvents as RawPositionEvent[]
      );

      // Mock position not found (will cause error in processAndSaveEvents)
      prismaMock.position.findUnique.mockResolvedValue(null);

      // Should throw error from processAndSaveEvents
      await expect(syncLedgerEvents(params, deps)).rejects.toThrow(
        'Position not found: pos_123'
      );
    });
  });

  describe('APR refresh', () => {
    it('should refresh APR periods after sync', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      await syncLedgerEvents(params, deps);

      expect(aprServiceMock.refresh).toHaveBeenCalledWith('pos_123');
      expect(aprServiceMock.refresh).toHaveBeenCalledTimes(1);
    });

    it('should refresh APR even when no new events found', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue({
        config: { blockNumber: '1500' },
      } as any);

      // Mock 2 events deleted
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([
        { id: 'evt_1' },
        { id: 'evt_2' },
      ] as any);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 2 });

      // Mock Etherscan returning no new events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      await syncLedgerEvents(params, deps);

      // Should refresh APR because events were deleted
      expect(aprServiceMock.refresh).toHaveBeenCalledWith('pos_123');
    });
  });

  describe('different chains', () => {
    it('should use correct NFPM deployment block for Arbitrum', async () => {
      const arbitrumParams = { ...params, chainId: 42161 }; // Arbitrum

      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(arbitrumParams, deps);

      // Arbitrum NFPM deployment is at block 165
      expect(result.fromBlock).toBe(165n);
    });

    it('should use correct NFPM deployment block for Base', async () => {
      const baseParams = { ...params, chainId: 8453 }; // Base

      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan returning no events
      etherscanClientMock.fetchPositionEvents.mockResolvedValue([]);

      // Mock APR service
      aprServiceMock.refresh.mockResolvedValue(undefined as any);

      const result = await syncLedgerEvents(baseParams, deps);

      // When no events exist, fromBlock = MIN(NFPM deployment, finalized block)
      // In this case: MIN(1371681, 2000) = 2000
      expect(result.fromBlock).toBe(2000n);
    });
  });

  describe('error handling', () => {
    it('should throw error and log when sync fails', async () => {
      // Mock finalized block service throwing error
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockRejectedValue(
        new Error('RPC connection failed')
      );

      await expect(syncLedgerEvents(params, deps)).rejects.toThrow(
        'RPC connection failed'
      );
    });

    it('should throw error when Etherscan fetch fails', async () => {
      // Mock finalized block
      evmBlockServiceMock.getLastFinalizedBlockNumber.mockResolvedValue(2000n);

      // Mock no existing events
      prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

      // Mock no events to delete
      prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);
      prismaMock.positionLedgerEvent.deleteMany.mockResolvedValue({ count: 0 });

      // Mock Etherscan throwing error
      etherscanClientMock.fetchPositionEvents.mockRejectedValue(
        new Error('Etherscan API rate limit')
      );

      await expect(syncLedgerEvents(params, deps)).rejects.toThrow(
        'Etherscan API rate limit'
      );
    });
  });
});
