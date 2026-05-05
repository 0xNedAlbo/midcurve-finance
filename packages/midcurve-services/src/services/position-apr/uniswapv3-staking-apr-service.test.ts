/**
 * UniswapV3StakingAprService — unit tests
 *
 * The APR service itself is a thin CRUD layer over `PositionAprPeriod`. The
 * actual bracketing logic (periods bounded by `STAKING_DISPOSE` events) lives
 * in `UniswapV3StakingLedgerService.recalculateAggregates` and is exercised
 * via the ledger service test suite. These tests cover the CRUD surface and
 * the `calculateSummary` math.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
    prismaMock: {
        positionAprPeriod: {
            create: vi.fn(),
            findMany: vi.fn(),
            deleteMany: vi.fn(),
        },
        positionLedgerEvent: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@midcurve/database', () => ({
    prisma: prismaMock,
    PrismaClient: class {},
}));

import { UniswapV3StakingAprService } from './uniswapv3-staking-apr-service.js';
import type { AprPeriodData } from '../types/position-apr/index.js';

const POSITION_ID = 'pos_staking_test';

function makeStoredPeriod(overrides: Record<string, unknown> = {}) {
    return {
        id: 'apr_1',
        positionId: POSITION_ID,
        startEventId: 'evt_start',
        endEventId: 'evt_end',
        startTimestamp: new Date('2026-01-01T00:00:00Z'),
        endTimestamp: new Date('2026-01-08T00:00:00Z'),
        durationSeconds: 7 * 86400,
        costBasis: '1000000000', // 1000 USDC at 6 decimals
        collectedYieldValue: '10000000', // 10 USDC
        aprBps: 5217, // ~52% APR
        eventCount: 5,
        ...overrides,
    };
}

describe('UniswapV3StakingAprService', () => {
    let service: UniswapV3StakingAprService;

    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.positionAprPeriod.create.mockReset();
        prismaMock.positionAprPeriod.findMany.mockReset().mockResolvedValue([]);
        prismaMock.positionAprPeriod.deleteMany.mockReset().mockResolvedValue({ count: 0 });
        prismaMock.positionLedgerEvent.findUnique.mockReset();
        service = new UniswapV3StakingAprService({ positionId: POSITION_ID });
    });

    // -------------------------------------------------------------------------
    // 1. persistAprPeriod
    // -------------------------------------------------------------------------
    it('persistAprPeriod — writes to PositionAprPeriod with correct fields', async () => {
        const period: AprPeriodData = {
            startEventId: 'evt_start',
            endEventId: 'evt_end',
            startTimestamp: new Date('2026-01-01T00:00:00Z'),
            endTimestamp: new Date('2026-01-08T00:00:00Z'),
            durationSeconds: 7 * 86400,
            costBasis: 1000_000000n,
            collectedYieldValue: 10_000000n,
            aprBps: 5217,
            eventCount: 5,
        };

        await service.persistAprPeriod(period);

        expect(prismaMock.positionAprPeriod.create).toHaveBeenCalledTimes(1);
        const args = prismaMock.positionAprPeriod.create.mock.calls[0]![0];
        expect(args.data.positionId).toBe(POSITION_ID);
        expect(args.data.startEventId).toBe('evt_start');
        expect(args.data.endEventId).toBe('evt_end');
        expect(args.data.costBasis).toBe('1000000000');
        expect(args.data.collectedYieldValue).toBe('10000000');
        expect(args.data.aprBps).toBe(5217);
    });

    // -------------------------------------------------------------------------
    // 2. fetchAprPeriods — empty store
    // -------------------------------------------------------------------------
    it('fetchAprPeriods — empty store returns []', async () => {
        prismaMock.positionAprPeriod.findMany.mockResolvedValue([]);

        const periods = await service.fetchAprPeriods();
        expect(periods).toEqual([]);
        expect(prismaMock.positionAprPeriod.findMany).toHaveBeenCalledWith({
            where: { positionId: POSITION_ID },
            orderBy: { startTimestamp: 'desc' },
        });
    });

    // -------------------------------------------------------------------------
    // 3. fetchAprPeriods — bigint round-trip
    // -------------------------------------------------------------------------
    it('fetchAprPeriods — converts string columns back to bigint', async () => {
        prismaMock.positionAprPeriod.findMany.mockResolvedValue([makeStoredPeriod()]);

        const periods = await service.fetchAprPeriods();
        expect(periods).toHaveLength(1);
        expect(periods[0]!.costBasis).toBe(1000_000000n);
        expect(periods[0]!.collectedYieldValue).toBe(10_000000n);
        expect(typeof periods[0]!.costBasis).toBe('bigint');
    });

    // -------------------------------------------------------------------------
    // 4. deleteAllAprPeriods
    // -------------------------------------------------------------------------
    it('deleteAllAprPeriods — deletes by positionId', async () => {
        prismaMock.positionAprPeriod.deleteMany.mockResolvedValue({ count: 3 });

        await service.deleteAllAprPeriods();
        expect(prismaMock.positionAprPeriod.deleteMany).toHaveBeenCalledWith({
            where: { positionId: POSITION_ID },
        });
    });

    // -------------------------------------------------------------------------
    // 5. calculateSummary — no periods → defaults to zeros + belowThreshold
    // -------------------------------------------------------------------------
    it('calculateSummary — no periods returns zero APR with belowThreshold=true', async () => {
        prismaMock.positionAprPeriod.findMany.mockResolvedValue([]);

        const summary = await service.calculateSummary({
            positionOpenedAt: new Date(Date.now() - 1000), // 1s ago
            costBasis: 1000_000000n,
            unclaimedYield: 0n,
        });

        expect(summary.realizedFees).toBe(0n);
        expect(summary.realizedApr).toBe(0);
        expect(summary.totalApr).toBe(0);
        expect(summary.belowThreshold).toBe(true); // 1s < 5min
        expect(summary.rewardApr).toBe(0); // staking has no reward APR
    });

    // -------------------------------------------------------------------------
    // 6. calculateSummary — single closed period
    // -------------------------------------------------------------------------
    it('calculateSummary — single period: realizedFees + realizedApr computed', async () => {
        const oneWeekAgo = new Date(Date.now() - 7 * 86400 * 1000);
        const halfWeekAgo = new Date(Date.now() - 3.5 * 86400 * 1000);
        prismaMock.positionAprPeriod.findMany.mockResolvedValue([
            makeStoredPeriod({
                startTimestamp: oneWeekAgo,
                endTimestamp: halfWeekAgo,
                durationSeconds: 3.5 * 86400,
            }),
        ]);

        const summary = await service.calculateSummary({
            positionOpenedAt: oneWeekAgo,
            costBasis: 1000_000000n,
            unclaimedYield: 0n,
        });

        expect(summary.realizedFees).toBe(10_000000n);
        expect(summary.realizedTWCostBasis).toBe(1000_000000n);
        expect(summary.realizedActiveDays).toBeGreaterThan(0);
        expect(summary.realizedApr).toBeGreaterThan(0);
        expect(summary.totalApr).toBeGreaterThan(0);
        expect(summary.belowThreshold).toBe(false);
    });
});
