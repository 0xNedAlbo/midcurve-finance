import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UniswapV3AprService } from './uniswapv3-apr-service.js';
import type { PrismaClient } from '@midcurve/database';

/**
 * UniswapV3AprService.calculateSummary — the open window's denominator (issue #135).
 *
 * The estimated (unrealized) APR used to divide unclaimed fees by the cost
 * basis standing at the end of the window. A position enlarged mid-window
 * therefore had its fees divided by capital that had not earned them, and its
 * displayed APR collapsed the instant the shares were minted.
 *
 * The denominator is now time-weighted over the open window, matching the
 * treatment completed periods have always received.
 *
 * Every expectation below depends on `asOf`. Each test states it explicitly via
 * `vi.setSystemTime` rather than relying on the ambient clock.
 *
 * Known limit of this suite: every case sets `params.costBasis` to the last
 * event's `costBasisAfter`, so the two sources the window draws on agree by
 * construction. In production they need not — the position aggregate and the
 * ledger's running total are written by different paths, and on the position
 * reported in #135 the displayed cost basis and the sum of the displayed event
 * values differ by a cent. The window's closing snapshot takes the aggregate
 * and every earlier snapshot takes the ledger, so a divergence between them
 * would land entirely on the final segment. Nothing here would see it.
 */

const t = (iso: string) => new Date(iso);

/** A ledger event row as `calculateUnrealizedTWCostBasis` selects it. */
function ledgerRow(
  timestamp: Date,
  costBasisAfter: bigint,
  blockNumber: number,
  logIndex = 0
) {
  return {
    timestamp,
    costBasisAfter: costBasisAfter.toString(),
    config: { blockNumber, logIndex },
  };
}

/** An APR period row as `fetchAprPeriods` maps it. */
function periodRow(params: {
  startTimestamp: Date;
  endTimestamp: Date;
  costBasis: bigint;
  collectedYieldValue: bigint;
}) {
  const durationSeconds = Math.floor(
    (params.endTimestamp.getTime() - params.startTimestamp.getTime()) / 1000
  );
  return {
    startEventId: 'evt_start',
    endEventId: 'evt_end',
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
    durationSeconds,
    costBasis: params.costBasis.toString(),
    collectedYieldValue: params.collectedYieldValue.toString(),
    aprBps: 0,
    eventCount: 2,
  };
}

describe('UniswapV3AprService.calculateSummary — unrealized denominator', () => {
  const periodFindMany = vi.fn();
  const eventFindMany = vi.fn();
  const eventFindUnique = vi.fn();

  const mockPrisma = {
    positionAprPeriod: { findMany: periodFindMany },
    positionLedgerEvent: {
      findMany: eventFindMany,
      findUnique: eventFindUnique,
    },
  } as unknown as PrismaClient;

  let service: UniswapV3AprService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    periodFindMany.mockResolvedValue([]);
    eventFindMany.mockResolvedValue([]);
    service = new UniswapV3AprService(
      { positionId: 'pos_1' },
      { prisma: mockPrisma }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reproduces the position reported in issue #135', async () => {
    // Two mints, no collection at any point. Ledger values, not screen values:
    // the displayed cost basis (79,999.93) and the sum of the displayed event
    // values (79,999.92) differ by a cent.
    const MINT_1 = t('2026-07-22T10:22:17Z'); // 49,999.99 USDC
    const MINT_2 = t('2026-08-11T09:24:07Z'); // +29,999.93 USDC
    const AS_OF = t('2026-08-12T10:57:03Z');
    vi.setSystemTime(AS_OF);

    eventFindMany.mockResolvedValue([
      ledgerRow(MINT_1, 49999_990000n, 100),
      ledgerRow(MINT_2, 79999_920000n, 200),
    ]);

    const summary = await service.calculateSummary({
      positionOpenedAt: MINT_1,
      costBasis: 79999_920000n,
      unclaimedYield: 608_420000n,
    });

    // ~19.96 days at ~50k plus ~1.06 days at ~80k, not 21 days at 80k.
    expect(summary.unrealizedTWCostBasis).toBe(51519_007246n);
    expect(summary.unrealizedCostBasis).toBe(79999_920000n);
    expect(summary.unrealizedActiveDays).toBe(21);
    expect(summary.unrealizedApr).toBeCloseTo(20.5, 1);

    // No collection has occurred, so the total is the estimate alone.
    expect(summary.realizedApr).toBe(0);
    expect(summary.totalApr).toBeCloseTo(summary.unrealizedApr, 10);

    // The flat denominator this replaces produced the 13.20% on screen.
    const flatApr =
      (Number(608_420000n) / Number(79999_920000n)) *
      (365 / 21.024143518518517) *
      100;
    expect(flatApr).toBeCloseTo(13.2, 1);
    expect(summary.unrealizedApr).toBeGreaterThan(flatApr);
  });

  it('does not move the APR at the instant a position is enlarged', async () => {
    // AC 1. Same instant, same unclaimed fees, capital added right now.
    const OPEN = t('2026-07-22T10:22:17Z');
    const AS_OF = t('2026-08-11T09:24:07Z');
    vi.setSystemTime(AS_OF);

    eventFindMany.mockResolvedValue([ledgerRow(OPEN, 49999_990000n, 100)]);
    const before = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 49999_990000n,
      unclaimedYield: 590_000000n,
    });

    eventFindMany.mockResolvedValue([
      ledgerRow(OPEN, 49999_990000n, 100),
      ledgerRow(AS_OF, 79999_920000n, 200),
    ]);
    const after = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 79999_920000n,
      unclaimedYield: 590_000000n,
    });

    expect(after.unrealizedTWCostBasis).toBe(before.unrealizedTWCostBasis);
    expect(after.unrealizedApr).toBe(before.unrealizedApr);
    expect(after.totalApr).toBe(before.totalApr);

    // The capital standing now still reports the enlarged figure.
    expect(after.unrealizedCostBasis).toBe(79999_920000n);
  });

  it('does not inflate the APR at the instant a position is reduced', async () => {
    // AC 3, on the NFT shape: a bare DECREASE_LIQUIDITY with no COLLECT in the
    // same transaction. A decrease-plus-collect multicall would settle the
    // withdrawn principal out of tokensOwed and hide the state under test.
    //
    // The numerator is unchanged across both calls by construction: withdrawn
    // principal is excluded upstream by calculateUnclaimedFeeAmounts, which
    // subtracts the ledger's uncollectedPrincipal from tokensOwed.
    const OPEN = t('2026-07-22T10:22:17Z');
    const AS_OF = t('2026-08-11T09:24:07Z');
    vi.setSystemTime(AS_OF);

    eventFindMany.mockResolvedValue([ledgerRow(OPEN, 79999_920000n, 100)]);
    const before = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 79999_920000n,
      unclaimedYield: 608_420000n,
    });

    eventFindMany.mockResolvedValue([
      ledgerRow(OPEN, 79999_920000n, 100),
      ledgerRow(AS_OF, 29999_930000n, 200),
    ]);
    const after = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 29999_930000n,
      unclaimedYield: 608_420000n,
    });

    expect(after.unrealizedTWCostBasis).toBe(79999_920000n);
    expect(after.unrealizedApr).toBe(before.unrealizedApr);

    // Without time-weighting the shrunken basis would nearly treble the APR.
    const flatApr =
      (Number(608_420000n) / Number(29999_930000n)) *
      (365 / after.unrealizedActiveDays) *
      100;
    expect(flatApr).toBeGreaterThan(after.unrealizedApr * 2);
  });

  it('is inert for a position that was never enlarged or reduced', async () => {
    // AC 5. The denominator must equal the current cost basis exactly, so the
    // displayed APR is identical to what the flat calculation produced.
    const OPEN = t('2026-07-22T10:22:17Z');
    const AS_OF = t('2026-08-12T10:57:03Z');
    vi.setSystemTime(AS_OF);

    eventFindMany.mockResolvedValue([ledgerRow(OPEN, 49999_990000n, 100)]);

    const summary = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 49999_990000n,
      unclaimedYield: 608_420000n,
    });

    expect(summary.unrealizedTWCostBasis).toBe(49999_990000n);
    expect(summary.unrealizedTWCostBasis).toBe(summary.unrealizedCostBasis);

    const flatApr =
      (Number(608_420000n) / Number(49999_990000n)) *
      (365 / 21.024143518518517) *
      100;
    expect(summary.unrealizedApr).toBeCloseTo(flatApr, 10);
  });

  it('opens the window at the last collection, not at the position opening', async () => {
    const OPEN = t('2026-06-01T00:00:00Z');
    const COLLECT = t('2026-07-22T10:22:17Z');
    const ENLARGE = t('2026-08-11T09:24:07Z');
    const AS_OF = t('2026-08-12T10:57:03Z');
    vi.setSystemTime(AS_OF);

    periodFindMany.mockResolvedValue([
      periodRow({
        startTimestamp: OPEN,
        endTimestamp: COLLECT,
        costBasis: 10000_000000n,
        collectedYieldValue: 100_000000n,
      }),
    ]);
    eventFindMany.mockResolvedValue([
      ledgerRow(OPEN, 10000_000000n, 50),
      // The collect leaves the cost basis untouched but bounds the window.
      ledgerRow(COLLECT, 49999_990000n, 100),
      ledgerRow(ENLARGE, 79999_920000n, 200),
    ]);

    const summary = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 79999_920000n,
      unclaimedYield: 608_420000n,
    });

    // Identical to the two-mint case: the pre-collect 10k never enters.
    expect(summary.unrealizedTWCostBasis).toBe(51519_007246n);
    expect(summary.unrealizedActiveDays).toBe(21);
    expect(summary.realizedActiveDays).toBeGreaterThan(0);
  });

  it('asks the database to filter out events outside the user\'s ownership', async () => {
    // The exclusion happens in the query, so this pins the filter rather than
    // the behaviour: a mock returning rows cannot demonstrate rows being left
    // behind. Read as "the where clause is still there", not as coverage of
    // ignored events being kept out of the weighting.
    vi.setSystemTime(t('2026-08-12T10:57:03Z'));
    eventFindMany.mockResolvedValue([
      ledgerRow(t('2026-07-22T10:22:17Z'), 49999_990000n, 100),
    ]);

    await service.calculateSummary({
      positionOpenedAt: t('2026-07-22T10:22:17Z'),
      costBasis: 49999_990000n,
      unclaimedYield: 608_420000n,
    });

    expect(eventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { positionId: 'pos_1', isIgnored: false },
      })
    );
  });

  it('orders the window by blockchain coordinates, not by timestamp', async () => {
    // Several events can share a block timestamp; only the last of them carries
    // into the next segment. Rows arrive from the database unordered.
    const OPEN = t('2026-07-22T10:22:17Z');
    const SAME_BLOCK = t('2026-08-11T09:24:07Z');
    const AS_OF = t('2026-08-12T10:57:03Z');
    vi.setSystemTime(AS_OF);

    eventFindMany.mockResolvedValue([
      ledgerRow(SAME_BLOCK, 79999_920000n, 200, 7),
      ledgerRow(OPEN, 49999_990000n, 100, 0),
      ledgerRow(SAME_BLOCK, 60000_000000n, 200, 3),
    ]);

    const summary = await service.calculateSummary({
      positionOpenedAt: OPEN,
      costBasis: 79999_920000n,
      unclaimedYield: 608_420000n,
    });

    // logIndex 7 wins over logIndex 3, giving the same result as the two-mint
    // case. Sorting by timestamp alone could carry the 60k forward instead.
    expect(summary.unrealizedTWCostBasis).toBe(51519_007246n);
  });

  it('does not throw when the window spans no time', async () => {
    const AS_OF = t('2026-08-12T10:57:03Z');
    vi.setSystemTime(AS_OF);
    eventFindMany.mockResolvedValue([ledgerRow(AS_OF, 49999_990000n, 100)]);

    const summary = await service.calculateSummary({
      positionOpenedAt: AS_OF,
      costBasis: 49999_990000n,
      unclaimedYield: 0n,
    });

    expect(summary.unrealizedTWCostBasis).toBe(49999_990000n);
    expect(summary.unrealizedApr).toBe(0);
    expect(summary.belowThreshold).toBe(true);
  });

  it('does not throw for a position with no ledger events', async () => {
    vi.setSystemTime(t('2026-08-12T10:57:03Z'));
    eventFindMany.mockResolvedValue([]);

    const summary = await service.calculateSummary({
      positionOpenedAt: t('2026-07-22T10:22:17Z'),
      costBasis: 0n,
      unclaimedYield: 0n,
    });

    expect(summary.unrealizedTWCostBasis).toBe(0n);
    expect(summary.unrealizedApr).toBe(0);
  });
});
