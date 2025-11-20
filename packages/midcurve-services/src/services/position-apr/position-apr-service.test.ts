import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PositionAprService } from './position-apr-service';
import type { AnyLedgerEvent } from '@midcurve/shared';
import type { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset } from 'vitest-mock-extended';

describe('PositionAprService - Period Attribution Bug Fix', () => {
  let aprService: PositionAprService;
  let mockPrisma: ReturnType<typeof mockDeep<PrismaClient>>;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaClient>();
    mockReset(mockPrisma);
    aprService = new PositionAprService(mockPrisma);
  });

  /**
   * Helper function to create a mock ledger event
   */
  function createMockEvent(
    id: string,
    eventType: AnyLedgerEvent['eventType'],
    timestamp: Date,
    rewards: Array<{ tokenId: string; tokenAmount: bigint; tokenValue: bigint }> = [],
    costBasisAfter: bigint = 10000_000000n // 10,000 USDC default
  ): AnyLedgerEvent {
    return {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      positionId: 'test-position-id',
      protocol: 'uniswapv3',
      previousId: null,
      timestamp,
      eventType,
      inputHash: `hash-${id}`,
      poolPrice: 4000_000000n,
      token0Amount: 1000_000000000000000000n,
      token1Amount: 1000_000000n,
      tokenValue: 2000_000000n,
      rewards,
      deltaCostBasis: 0n,
      costBasisAfter,
      deltaPnl: 0n,
      pnlAfter: 0n,
      config: {},
      state: {},
    } as AnyLedgerEvent;
  }

  describe('Bug Fix: COLLECT event attribution', () => {
    it('should attribute fees to the period where they were earned (ending with COLLECT)', async () => {
      // Scenario: COLLECT followed by quick INCREASE_POSITION
      // The fees in the COLLECT should belong to the period BEFORE the collect,
      // not the short period after it.

      const events: AnyLedgerEvent[] = [
        // Period 1: Initial increase
        createMockEvent(
          'event1',
          'INCREASE_POSITION',
          new Date('2025-11-14T07:00:00Z'),
          [],
          10000_000000n
        ),

        // Period 1 ends: COLLECT with 25 USDC fees earned over ~6 days
        createMockEvent(
          'event2',
          'COLLECT',
          new Date('2025-11-20T09:39:11Z'),
          [
            {
              tokenId: 'token-usdc',
              tokenAmount: 25_000000n,
              tokenValue: 25_000000n,
            },
          ],
          10000_000000n
        ),

        // Period 2: Quick increase right after collect (588 seconds later)
        createMockEvent(
          'event3',
          'INCREASE_POSITION',
          new Date('2025-11-20T09:48:59Z'),
          [],
          15000_000000n
        ),
      ];

      // Access the private method via type assertion for testing
      const periods = (aprService as any).divideEventsIntoPeriods(events);

      // EXPECTED BEHAVIOR:
      // Period 1: [INCREASE_POSITION, COLLECT] with 25 USDC fees
      // Period 2: [INCREASE_POSITION] with 0 fees

      expect(periods).toHaveLength(2);

      // Period 1 should end with COLLECT and include its fees
      expect(periods[0]).toHaveLength(2);
      expect(periods[0][0].eventType).toBe('INCREASE_POSITION');
      expect(periods[0][1].eventType).toBe('COLLECT');
      expect(periods[0][1].rewards[0].tokenValue).toBe(25_000000n);

      // Period 2 should start after COLLECT with no fees
      expect(periods[1]).toHaveLength(1);
      expect(periods[1][0].eventType).toBe('INCREASE_POSITION');
      expect(periods[1][0].rewards).toHaveLength(0);
    });

    it('should NOT include COLLECT event in the next period', async () => {
      const events: AnyLedgerEvent[] = [
        createMockEvent('event1', 'INCREASE_POSITION', new Date('2025-11-01T00:00:00Z')),
        createMockEvent(
          'event2',
          'COLLECT',
          new Date('2025-11-10T00:00:00Z'),
          [{ tokenId: 'token-usdc', tokenAmount: 10_000000n, tokenValue: 10_000000n }]
        ),
        createMockEvent('event3', 'INCREASE_POSITION', new Date('2025-11-11T00:00:00Z')),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      // Period 1 should end with COLLECT
      expect(periods[0][periods[0].length - 1].eventType).toBe('COLLECT');

      // Period 2 should NOT start with COLLECT (this was the bug)
      expect(periods[1][0].eventType).not.toBe('COLLECT');
      expect(periods[1][0].eventType).toBe('INCREASE_POSITION');
    });

    it('should handle the bug example from production data', async () => {
      // Real production example that caused the bug:
      // Last period showed 18,793% APR because 48.88 USDC earned over 6 days
      // was attributed to a 588-second period.

      const events: AnyLedgerEvent[] = [
        createMockEvent('collect1', 'COLLECT', new Date('2025-11-14T07:23:11Z'), [
          { tokenId: 'token-usdc', tokenAmount: 25868098n, tokenValue: 25868098n },
        ]),

        createMockEvent('increase1', 'INCREASE_POSITION', new Date('2025-11-14T08:28:59Z')),
        createMockEvent('increase2', 'INCREASE_POSITION', new Date('2025-11-16T20:19:59Z')),
        createMockEvent('increase3', 'INCREASE_POSITION', new Date('2025-11-18T17:00:11Z')),

        createMockEvent('collect2', 'COLLECT', new Date('2025-11-20T09:39:11Z'), [
          { tokenId: 'token-usdc', tokenAmount: 48887918n, tokenValue: 48887918n },
        ]),

        createMockEvent('increase4', 'INCREASE_POSITION', new Date('2025-11-20T09:48:59Z')),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      // EXPECTED: 3 periods
      expect(periods).toHaveLength(3);

      // Period 1: [COLLECT1] - contains first collect
      expect(periods[0]).toHaveLength(1);
      expect(periods[0][0].eventType).toBe('COLLECT');

      // Period 2: [INCREASE1, INCREASE2, INCREASE3, COLLECT2]
      // This period should contain the 48.88 USDC fees from COLLECT2
      expect(periods[1]).toHaveLength(4);
      expect(periods[1][0].eventType).toBe('INCREASE_POSITION');
      expect(periods[1][3].eventType).toBe('COLLECT');
      expect(periods[1][3].rewards[0].tokenValue).toBe(48887918n);

      // Period 3: [INCREASE4] - open period with no fees collected yet
      expect(periods[2]).toHaveLength(1);
      expect(periods[2][0].eventType).toBe('INCREASE_POSITION');
      expect(periods[2][0].rewards).toHaveLength(0);

      // Duration check: Period 2 should span ~6 days, not 588 seconds
      const period2Start = periods[1][0].timestamp;
      const period2End = periods[1][3].timestamp;
      const durationSeconds = (period2End.getTime() - period2Start.getTime()) / 1000;

      // Should be approximately 6 days (518,952 seconds)
      expect(durationSeconds).toBeGreaterThan(500000);
      expect(durationSeconds).toBeLessThan(530000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle open period with only INCREASE/DECREASE events (no COLLECT)', async () => {
      const events: AnyLedgerEvent[] = [
        createMockEvent('collect1', 'COLLECT', new Date('2025-11-01T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 10_000000n, tokenValue: 10_000000n },
        ]),
        createMockEvent('increase1', 'INCREASE_POSITION', new Date('2025-11-02T00:00:00Z')),
        createMockEvent('decrease1', 'DECREASE_POSITION', new Date('2025-11-03T00:00:00Z')),
        createMockEvent('increase2', 'INCREASE_POSITION', new Date('2025-11-04T00:00:00Z')),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      expect(periods).toHaveLength(2);

      // Period 1: ends with COLLECT
      expect(periods[0]).toHaveLength(1);
      expect(periods[0][0].eventType).toBe('COLLECT');

      // Period 2: open period with multiple events, no COLLECT
      expect(periods[1]).toHaveLength(3);
      expect(periods[1][0].eventType).toBe('INCREASE_POSITION');
      expect(periods[1][1].eventType).toBe('DECREASE_POSITION');
      expect(periods[1][2].eventType).toBe('INCREASE_POSITION');

      // No COLLECT events in period 2
      const collectsInPeriod2 = periods[1].filter((e) => e.eventType === 'COLLECT');
      expect(collectsInPeriod2).toHaveLength(0);
    });

    it('should handle position ending with a COLLECT event', async () => {
      const events: AnyLedgerEvent[] = [
        createMockEvent('increase1', 'INCREASE_POSITION', new Date('2025-11-01T00:00:00Z')),
        createMockEvent('increase2', 'INCREASE_POSITION', new Date('2025-11-02T00:00:00Z')),
        createMockEvent('collect1', 'COLLECT', new Date('2025-11-03T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 20_000000n, tokenValue: 20_000000n },
        ]),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      // Should be 1 period ending with COLLECT
      expect(periods).toHaveLength(1);
      expect(periods[0]).toHaveLength(3);
      expect(periods[0][2].eventType).toBe('COLLECT');
      expect(periods[0][2].rewards[0].tokenValue).toBe(20_000000n);
    });

    it('should handle multiple COLLECTs with events in between', async () => {
      const events: AnyLedgerEvent[] = [
        createMockEvent('increase1', 'INCREASE_POSITION', new Date('2025-11-01T00:00:00Z')),
        createMockEvent('collect1', 'COLLECT', new Date('2025-11-05T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 10_000000n, tokenValue: 10_000000n },
        ]),
        createMockEvent('increase2', 'INCREASE_POSITION', new Date('2025-11-06T00:00:00Z')),
        createMockEvent('collect2', 'COLLECT', new Date('2025-11-10T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 15_000000n, tokenValue: 15_000000n },
        ]),
        createMockEvent('increase3', 'INCREASE_POSITION', new Date('2025-11-11T00:00:00Z')),
        createMockEvent('collect3', 'COLLECT', new Date('2025-11-15T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 20_000000n, tokenValue: 20_000000n },
        ]),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      expect(periods).toHaveLength(3);

      // Period 1: [INCREASE1, COLLECT1] with 10 USDC
      expect(periods[0]).toHaveLength(2);
      expect(periods[0][1].eventType).toBe('COLLECT');
      expect(periods[0][1].rewards[0].tokenValue).toBe(10_000000n);

      // Period 2: [INCREASE2, COLLECT2] with 15 USDC
      expect(periods[1]).toHaveLength(2);
      expect(periods[1][1].eventType).toBe('COLLECT');
      expect(periods[1][1].rewards[0].tokenValue).toBe(15_000000n);

      // Period 3: [INCREASE3, COLLECT3] with 20 USDC
      expect(periods[2]).toHaveLength(2);
      expect(periods[2][1].eventType).toBe('COLLECT');
      expect(periods[2][1].rewards[0].tokenValue).toBe(20_000000n);
    });

    it('should handle position with no COLLECT events at all', async () => {
      const events: AnyLedgerEvent[] = [
        createMockEvent('increase1', 'INCREASE_POSITION', new Date('2025-11-01T00:00:00Z')),
        createMockEvent('increase2', 'INCREASE_POSITION', new Date('2025-11-02T00:00:00Z')),
        createMockEvent('decrease1', 'DECREASE_POSITION', new Date('2025-11-03T00:00:00Z')),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      // Should be 1 open period with no COLLECT
      expect(periods).toHaveLength(1);
      expect(periods[0]).toHaveLength(3);

      // No COLLECT events
      const collects = periods[0].filter((e) => e.eventType === 'COLLECT');
      expect(collects).toHaveLength(0);
    });

    it('should handle single COLLECT event in a period', async () => {
      // Edge case: Just one COLLECT with no other events in the period
      const events: AnyLedgerEvent[] = [
        createMockEvent('collect1', 'COLLECT', new Date('2025-11-01T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 5_000000n, tokenValue: 5_000000n },
        ]),
        createMockEvent('collect2', 'COLLECT', new Date('2025-11-10T00:00:00Z'), [
          { tokenId: 'token-usdc', tokenAmount: 8_000000n, tokenValue: 8_000000n },
        ]),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      expect(periods).toHaveLength(2);

      // Each period should have exactly one COLLECT event
      expect(periods[0]).toHaveLength(1);
      expect(periods[0][0].eventType).toBe('COLLECT');
      expect(periods[0][0].rewards[0].tokenValue).toBe(5_000000n);

      expect(periods[1]).toHaveLength(1);
      expect(periods[1][0].eventType).toBe('COLLECT');
      expect(periods[1][0].rewards[0].tokenValue).toBe(8_000000n);
    });

    it('should handle empty events array', async () => {
      const events: AnyLedgerEvent[] = [];

      const periods = (aprService as any).divideEventsIntoPeriods(events);

      expect(periods).toHaveLength(0);
    });
  });

  describe('APR Calculation Verification', () => {
    it('should calculate correct APR with fixed period boundaries', async () => {
      // This test verifies that the APR calculation uses the correct duration
      // after fixing the period attribution bug

      const events: AnyLedgerEvent[] = [
        createMockEvent(
          'increase1',
          'INCREASE_POSITION',
          new Date('2025-11-01T00:00:00Z'),
          [],
          10000_000000n // 10,000 USDC cost basis
        ),
        createMockEvent(
          'collect1',
          'COLLECT',
          new Date('2025-11-11T00:00:00Z'), // 10 days later
          [
            {
              tokenId: 'token-usdc',
              tokenAmount: 100_000000n, // 100 USDC fees
              tokenValue: 100_000000n,
            },
          ],
          10000_000000n
        ),
      ];

      const periods = (aprService as any).divideEventsIntoPeriods(events);
      const aprPeriod = (aprService as any).buildAprPeriodFromEvents('test-position', periods[0]);

      // Verify duration is 10 days (864,000 seconds)
      expect(aprPeriod.durationSeconds).toBe(864000);

      // Verify fees are 100 USDC
      expect(aprPeriod.collectedFeeValue).toBe(100_000000n);

      // Calculate expected APR:
      // APR = (fees / costBasis) * (secondsInYear / durationSeconds) * 10000
      // APR = (100 / 10000) * (31536000 / 864000) * 10000
      // APR = 0.01 * 36.5 * 10000 = 3650 bps (36.5%)
      // Allow for small rounding differences (within 5 bps)
      expect(aprPeriod.aprBps).toBeCloseTo(3650, -1);
    });
  });
});
