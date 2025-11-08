import { describe, it, expect } from 'vitest';
import {
  convertMissingEventToRawEvent,
  mergeEvents,
  deduplicateEvents,
  findConfirmedMissingEvents,
} from './missing-events.js';
import type { UniswapV3SyncEventDB } from '../../../types/uniswapv3/position-sync-state-db.js';
import type { RawPositionEvent } from '../../../../clients/etherscan/types.js';
import type { PositionLedgerEvent } from '@midcurve/shared';

describe('convertMissingEventToRawEvent', () => {
  it('converts INCREASE_LIQUIDITY event correctly', () => {
    const dbEvent: UniswapV3SyncEventDB = {
      eventType: 'INCREASE_LIQUIDITY',
      timestamp: '2025-01-15T10:30:00.000Z',
      blockNumber: '21000000',
      transactionIndex: 42,
      logIndex: 3,
      transactionHash: '0xabc123',
      liquidity: '1000000000000000000',
      amount0: '500000000000000000',
      amount1: '1000000000',
    };

    const result = convertMissingEventToRawEvent(dbEvent, 1, '12345');

    expect(result).toEqual({
      eventType: 'INCREASE_LIQUIDITY',
      tokenId: '12345',
      chainId: 1,
      blockNumber: 21000000n,
      transactionIndex: 42,
      logIndex: 3,
      transactionHash: '0xabc123',
      blockTimestamp: new Date('2025-01-15T10:30:00.000Z'),
      liquidity: '1000000000000000000',
      amount0: '500000000000000000',
      amount1: '1000000000',
    });
  });

  it('converts DECREASE_LIQUIDITY event correctly', () => {
    const dbEvent: UniswapV3SyncEventDB = {
      eventType: 'DECREASE_LIQUIDITY',
      timestamp: '2025-01-15T10:35:00.000Z',
      blockNumber: '21000100',
      transactionIndex: 10,
      logIndex: 1,
      transactionHash: '0xdef456',
      liquidity: '500000000000000000',
      amount0: '250000000000000000',
      amount1: '500000000',
    };

    const result = convertMissingEventToRawEvent(dbEvent, 1, '12345');

    expect(result).toEqual({
      eventType: 'DECREASE_LIQUIDITY',
      tokenId: '12345',
      chainId: 1,
      blockNumber: 21000100n,
      transactionIndex: 10,
      logIndex: 1,
      transactionHash: '0xdef456',
      blockTimestamp: new Date('2025-01-15T10:35:00.000Z'),
      liquidity: '500000000000000000',
      amount0: '250000000000000000',
      amount1: '500000000',
    });
  });

  it('converts COLLECT event correctly', () => {
    const dbEvent: UniswapV3SyncEventDB = {
      eventType: 'COLLECT',
      timestamp: '2025-01-15T10:40:00.000Z',
      blockNumber: '21000200',
      transactionIndex: 5,
      logIndex: 2,
      transactionHash: '0xghi789',
      amount0: '100000000000000000',
      amount1: '200000000',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    const result = convertMissingEventToRawEvent(dbEvent, 1, '12345');

    expect(result).toEqual({
      eventType: 'COLLECT',
      tokenId: '12345',
      chainId: 1,
      blockNumber: 21000200n,
      transactionIndex: 5,
      logIndex: 2,
      transactionHash: '0xghi789',
      blockTimestamp: new Date('2025-01-15T10:40:00.000Z'),
      amount0: '100000000000000000',
      amount1: '200000000',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    });
  });

});

describe('mergeEvents', () => {
  it('merges empty arrays', () => {
    const result = mergeEvents([], []);
    expect(result).toEqual([]);
  });

  it('merges Etherscan events only', () => {
    const etherscanEvents: RawPositionEvent[] = [
      {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 1,
        logIndex: 0,
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
    ];

    const result = mergeEvents(etherscanEvents, []);
    expect(result).toEqual(etherscanEvents);
  });

  it('merges missing events only', () => {
    const missingEvents: RawPositionEvent[] = [
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 2,
        logIndex: 0,
        transactionHash: '0xdef',
        blockTimestamp: new Date('2025-01-15T10:05:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = mergeEvents([], missingEvents);
    expect(result).toEqual(missingEvents);
  });

  it('merges both Etherscan and missing events', () => {
    const etherscanEvents: RawPositionEvent[] = [
      {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 1,
        logIndex: 0,
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
    ];

    const missingEvents: RawPositionEvent[] = [
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 2,
        logIndex: 0,
        transactionHash: '0xdef',
        blockTimestamp: new Date('2025-01-15T10:05:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = mergeEvents(etherscanEvents, missingEvents);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(etherscanEvents[0]);
    expect(result[1]).toEqual(missingEvents[0]);
  });

  it('preserves order (Etherscan first, then missing)', () => {
    const etherscanEvents: RawPositionEvent[] = [
      {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 1,
        logIndex: 0,
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
      {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 2,
        logIndex: 0,
        transactionHash: '0xdef',
        blockTimestamp: new Date('2025-01-15T10:05:00.000Z'),
        liquidity: '500',
        amount0: '250',
        amount1: '500',
      },
    ];

    const missingEvents: RawPositionEvent[] = [
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xghi',
        blockTimestamp: new Date('2025-01-15T10:10:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = mergeEvents(etherscanEvents, missingEvents);
    expect(result).toHaveLength(3);
    expect(result[0].transactionHash).toBe('0xabc');
    expect(result[1].transactionHash).toBe('0xdef');
    expect(result[2].transactionHash).toBe('0xghi');
  });
});

describe('deduplicateEvents', () => {
  it('returns empty array for empty input', () => {
    const result = deduplicateEvents([]);
    expect(result).toEqual([]);
  });

  it('returns same array if no duplicates', () => {
    const events: RawPositionEvent[] = [
      {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 1,
        logIndex: 0,
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 2,
        logIndex: 0,
        transactionHash: '0xdef',
        blockTimestamp: new Date('2025-01-15T10:05:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = deduplicateEvents(events);
    expect(result).toHaveLength(2);
    expect(result).toEqual(events);
  });

  it('removes duplicate based on blockchain coordinates', () => {
    const events: RawPositionEvent[] = [
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc', // Same coordinates
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].transactionHash).toBe('0xabc');
  });

  it('keeps first occurrence when duplicates found', () => {
    const events: RawPositionEvent[] = [
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xfirst',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xsecond', // Same coordinates, different tx hash
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        amount0: '150', // Different amounts
        amount1: '250',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].transactionHash).toBe('0xfirst'); // First one kept
    expect(result[0].amount0).toBe('100'); // First one's data
  });

  it('handles multiple duplicates correctly', () => {
    const events: RawPositionEvent[] = [
      {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 1,
        logIndex: 0,
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 2,
        logIndex: 0,
        transactionHash: '0xdef',
        blockTimestamp: new Date('2025-01-15T10:05:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
      {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 1,
        logIndex: 0,
        transactionHash: '0xabc', // Duplicate of first
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 2,
        logIndex: 0,
        transactionHash: '0xdef', // Duplicate of second
        blockTimestamp: new Date('2025-01-15T10:05:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = deduplicateEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0].transactionHash).toBe('0xabc');
    expect(result[1].transactionHash).toBe('0xdef');
  });

  it('treats different log indices as different events', () => {
    const events: RawPositionEvent[] = [
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 0, // Different log index
        transactionHash: '0xabc',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
      {
        eventType: 'COLLECT',
        tokenId: '12345',
        chainId: 1,
        blockNumber: 1000n,
        transactionIndex: 3,
        logIndex: 1, // Different log index
        transactionHash: '0xdef',
        blockTimestamp: new Date('2025-01-15T10:00:00.000Z'),
        amount0: '150',
        amount1: '250',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const result = deduplicateEvents(events);
    expect(result).toHaveLength(2); // Both kept (different coordinates)
  });
});

describe('findConfirmedMissingEvents', () => {
  it('returns empty array if no missing events', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [];
    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toEqual([]);
  });

  it('returns empty array if no ledger events', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [
      {
        eventType: 'COLLECT',
        timestamp: '2025-01-15T10:00:00.000Z',
        blockNumber: '1000',
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];
    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toEqual([]);
  });

  it('returns empty array if no matches', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [
      {
        eventType: 'COLLECT',
        timestamp: '2025-01-15T10:00:00.000Z',
        blockNumber: '1000',
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [
      {
        id: 'event1',
        positionId: 'pos1',
        protocol: 'uniswapv3',
        eventType: 'COLLECT',
        timestamp: new Date('2025-01-15T10:00:00.000Z'),
        config: {
          chainId: 1,
          nftId: 12345n,
          blockNumber: 999n, // Different block
          txIndex: 3,
          logIndex: 0,
          txHash: '0xabc',
        },
        state: {},
        poolPrice: 0n,
        token0Holdings: 0n,
        token1Holdings: 0n,
        positionValue: 0n,
        totalCostBasis: 0n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        totalPnl: 0n,
        totalFeesCollected: 0n,
        inputHash: 'hash1',
        previousId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toEqual([]);
  });

  it('finds confirmed event by matching coordinates', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [
      {
        eventType: 'COLLECT',
        timestamp: '2025-01-15T10:00:00.000Z',
        blockNumber: '1000',
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [
      {
        id: 'event1',
        positionId: 'pos1',
        protocol: 'uniswapv3',
        eventType: 'COLLECT',
        timestamp: new Date('2025-01-15T10:00:00.000Z'),
        config: {
          chainId: 1,
          nftId: 12345n,
          blockNumber: 1000n,
          txIndex: 3,
          logIndex: 0,
          txHash: '0xabc',
        },
        state: {},
        poolPrice: 0n,
        token0Holdings: 0n,
        token1Holdings: 0n,
        positionValue: 0n,
        totalCostBasis: 0n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        totalPnl: 0n,
        totalFeesCollected: 0n,
        inputHash: 'hash1',
        previousId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toEqual(['0xabc']);
  });

  it('finds multiple confirmed events', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [
      {
        eventType: 'COLLECT',
        timestamp: '2025-01-15T10:00:00.000Z',
        blockNumber: '1000',
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
      {
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: '2025-01-15T10:05:00.000Z',
        blockNumber: '1001',
        transactionIndex: 5,
        logIndex: 1,
        transactionHash: '0xdef',
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
    ];

    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [
      {
        id: 'event1',
        positionId: 'pos1',
        protocol: 'uniswapv3',
        eventType: 'COLLECT',
        timestamp: new Date('2025-01-15T10:00:00.000Z'),
        config: {
          chainId: 1,
          nftId: 12345n,
          blockNumber: 1000n,
          txIndex: 3,
          logIndex: 0,
          txHash: '0xabc',
        },
        state: {},
        poolPrice: 0n,
        token0Holdings: 0n,
        token1Holdings: 0n,
        positionValue: 0n,
        totalCostBasis: 0n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        totalPnl: 0n,
        totalFeesCollected: 0n,
        inputHash: 'hash1',
        previousId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'event2',
        positionId: 'pos1',
        protocol: 'uniswapv3',
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: new Date('2025-01-15T10:05:00.000Z'),
        config: {
          chainId: 1,
          nftId: 12345n,
          blockNumber: 1001n,
          txIndex: 5,
          logIndex: 1,
          txHash: '0xdef',
        },
        state: {},
        poolPrice: 0n,
        token0Holdings: 0n,
        token1Holdings: 0n,
        positionValue: 0n,
        totalCostBasis: 1000n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        totalPnl: 0n,
        totalFeesCollected: 0n,
        inputHash: 'hash2',
        previousId: 'event1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toHaveLength(2);
    expect(result).toContain('0xabc');
    expect(result).toContain('0xdef');
  });

  it('finds partial matches (some confirmed, some not)', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [
      {
        eventType: 'COLLECT',
        timestamp: '2025-01-15T10:00:00.000Z',
        blockNumber: '1000',
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
      {
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: '2025-01-15T10:05:00.000Z',
        blockNumber: '1001',
        transactionIndex: 5,
        logIndex: 1,
        transactionHash: '0xdef',
        liquidity: '1000',
        amount0: '500',
        amount1: '1000',
      },
    ];

    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [
      {
        id: 'event1',
        positionId: 'pos1',
        protocol: 'uniswapv3',
        eventType: 'COLLECT',
        timestamp: new Date('2025-01-15T10:00:00.000Z'),
        config: {
          chainId: 1,
          nftId: 12345n,
          blockNumber: 1000n,
          txIndex: 3,
          logIndex: 0,
          txHash: '0xabc',
        },
        state: {},
        poolPrice: 0n,
        token0Holdings: 0n,
        token1Holdings: 0n,
        positionValue: 0n,
        totalCostBasis: 0n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        totalPnl: 0n,
        totalFeesCollected: 0n,
        inputHash: 'hash1',
        previousId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Second missing event NOT in ledger
    ];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toHaveLength(1);
    expect(result).toContain('0xabc');
    expect(result).not.toContain('0xdef');
  });

  it('matches by coordinates, not by transaction hash', () => {
    const missingEvents: UniswapV3SyncEventDB[] = [
      {
        eventType: 'COLLECT',
        timestamp: '2025-01-15T10:00:00.000Z',
        blockNumber: '1000',
        transactionIndex: 3,
        logIndex: 0,
        transactionHash: '0xabc',
        amount0: '100',
        amount1: '200',
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      },
    ];

    const ledgerEvents: PositionLedgerEvent<'uniswapv3'>[] = [
      {
        id: 'event1',
        positionId: 'pos1',
        protocol: 'uniswapv3',
        eventType: 'COLLECT',
        timestamp: new Date('2025-01-15T10:00:00.000Z'),
        config: {
          chainId: 1,
          nftId: 12345n,
          blockNumber: 1000n,
          txIndex: 3,
          logIndex: 0,
          txHash: '0xdifferent', // Different tx hash, same coordinates
        },
        state: {},
        poolPrice: 0n,
        token0Holdings: 0n,
        token1Holdings: 0n,
        positionValue: 0n,
        totalCostBasis: 0n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        totalPnl: 0n,
        totalFeesCollected: 0n,
        inputHash: 'hash1',
        previousId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = findConfirmedMissingEvents(missingEvents, ledgerEvents);
    expect(result).toEqual(['0xabc']); // Still matched by coordinates
  });
});
