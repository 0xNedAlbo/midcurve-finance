/**
 * Unit tests for event sorting utilities
 */

import { describe, it, expect } from 'vitest';
import { sortRawEventsByBlockchain } from './event-sorting.js';
import type { RawPositionEvent } from '../../../../clients/etherscan/types.js';

describe('sortRawEventsByBlockchain', () => {
  it('should sort events by block number ascending', () => {
    const events: RawPositionEvent[] = [
      createMockEvent({ blockNumber: 1000n }),
      createMockEvent({ blockNumber: 500n }),
      createMockEvent({ blockNumber: 1500n }),
    ];

    const sorted = sortRawEventsByBlockchain(events);

    expect(sorted[0].blockNumber).toBe(500n);
    expect(sorted[1].blockNumber).toBe(1000n);
    expect(sorted[2].blockNumber).toBe(1500n);
  });

  it('should sort events in same block by transaction index', () => {
    const events: RawPositionEvent[] = [
      createMockEvent({ blockNumber: 1000n, transactionIndex: 5n }),
      createMockEvent({ blockNumber: 1000n, transactionIndex: 2n }),
      createMockEvent({ blockNumber: 1000n, transactionIndex: 8n }),
    ];

    const sorted = sortRawEventsByBlockchain(events);

    expect(sorted[0].transactionIndex).toBe(2n);
    expect(sorted[1].transactionIndex).toBe(5n);
    expect(sorted[2].transactionIndex).toBe(8n);
  });

  it('should sort events in same transaction by log index', () => {
    const events: RawPositionEvent[] = [
      createMockEvent({
        blockNumber: 1000n,
        transactionIndex: 5n,
        logIndex: 3n,
      }),
      createMockEvent({
        blockNumber: 1000n,
        transactionIndex: 5n,
        logIndex: 1n,
      }),
      createMockEvent({
        blockNumber: 1000n,
        transactionIndex: 5n,
        logIndex: 2n,
      }),
    ];

    const sorted = sortRawEventsByBlockchain(events);

    expect(sorted[0].logIndex).toBe(1n);
    expect(sorted[1].logIndex).toBe(2n);
    expect(sorted[2].logIndex).toBe(3n);
  });

  it('should handle complex sorting with all three levels', () => {
    const events: RawPositionEvent[] = [
      createMockEvent({
        blockNumber: 2000n,
        transactionIndex: 1n,
        logIndex: 1n,
      }),
      createMockEvent({
        blockNumber: 1000n,
        transactionIndex: 5n,
        logIndex: 2n,
      }),
      createMockEvent({
        blockNumber: 1000n,
        transactionIndex: 3n,
        logIndex: 1n,
      }),
      createMockEvent({
        blockNumber: 1000n,
        transactionIndex: 5n,
        logIndex: 1n,
      }),
      createMockEvent({
        blockNumber: 1500n,
        transactionIndex: 2n,
        logIndex: 3n,
      }),
    ];

    const sorted = sortRawEventsByBlockchain(events);

    // Expected order:
    // 1. Block 1000, tx 3, log 1
    // 2. Block 1000, tx 5, log 1
    // 3. Block 1000, tx 5, log 2
    // 4. Block 1500, tx 2, log 3
    // 5. Block 2000, tx 1, log 1

    expect(sorted[0].blockNumber).toBe(1000n);
    expect(sorted[0].transactionIndex).toBe(3n);
    expect(sorted[0].logIndex).toBe(1n);

    expect(sorted[1].blockNumber).toBe(1000n);
    expect(sorted[1].transactionIndex).toBe(5n);
    expect(sorted[1].logIndex).toBe(1n);

    expect(sorted[2].blockNumber).toBe(1000n);
    expect(sorted[2].transactionIndex).toBe(5n);
    expect(sorted[2].logIndex).toBe(2n);

    expect(sorted[3].blockNumber).toBe(1500n);
    expect(sorted[3].transactionIndex).toBe(2n);
    expect(sorted[3].logIndex).toBe(3n);

    expect(sorted[4].blockNumber).toBe(2000n);
    expect(sorted[4].transactionIndex).toBe(1n);
    expect(sorted[4].logIndex).toBe(1n);
  });

  it('should not mutate original array', () => {
    const events: RawPositionEvent[] = [
      createMockEvent({ blockNumber: 1000n }),
      createMockEvent({ blockNumber: 500n }),
    ];

    const original = [...events];
    sortRawEventsByBlockchain(events);

    expect(events).toEqual(original);
  });

  it('should handle empty array', () => {
    const events: RawPositionEvent[] = [];
    const sorted = sortRawEventsByBlockchain(events);

    expect(sorted).toEqual([]);
  });

  it('should handle single event', () => {
    const events: RawPositionEvent[] = [createMockEvent({ blockNumber: 1000n })];
    const sorted = sortRawEventsByBlockchain(events);

    expect(sorted).toHaveLength(1);
    expect(sorted[0].blockNumber).toBe(1000n);
  });

  it('should handle already sorted events', () => {
    const events: RawPositionEvent[] = [
      createMockEvent({ blockNumber: 500n }),
      createMockEvent({ blockNumber: 1000n }),
      createMockEvent({ blockNumber: 1500n }),
    ];

    const sorted = sortRawEventsByBlockchain(events);

    expect(sorted[0].blockNumber).toBe(500n);
    expect(sorted[1].blockNumber).toBe(1000n);
    expect(sorted[2].blockNumber).toBe(1500n);
  });
});

// Helper function to create mock events
function createMockEvent(
  overrides: Partial<RawPositionEvent> = {}
): RawPositionEvent {
  return {
    eventType: 'INCREASE_LIQUIDITY',
    blockNumber: 1000n,
    blockTimestamp: new Date('2024-01-01T00:00:00Z'),
    transactionHash: '0x1234567890abcdef',
    transactionIndex: 0n,
    logIndex: 0n,
    amount0: 1000000n,
    amount1: 2000000n,
    liquidity: 500000n,
    ...overrides,
  } as RawPositionEvent;
}
