/**
 * NavSnapshotService
 *
 * CRUD operations for daily NAV (Net Asset Value) snapshots.
 * Provides creation, retrieval, and period comparison queries.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { PositionBreakdownItem } from '@midcurve/shared';
import { getCalendarPeriodBoundaries } from '@midcurve/shared';
import type { CalendarPeriod } from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

// =============================================================================
// Types
// =============================================================================

export interface NavSnapshotServiceDependencies {
  prisma?: PrismaClient;
}

export interface CreateNavSnapshotInput {
  userId: string;
  snapshotDate: Date;
  snapshotType: 'daily' | 'manual';
  reportingCurrency: string;
  valuationMethod: string;
  totalAssets: string;
  totalLiabilities: string;
  netAssetValue: string;
  depositedLiquidityAtCost: string;
  markToMarketAdjustment: string;
  unclaimedFees: string;
  contributedCapital: string;
  capitalReturned: string;
  retainedRealizedWithdrawals: string;
  retainedRealizedFees: string;
  retainedUnrealizedPrice: string;
  retainedUnrealizedFees: string;
  activePositionCount: number;
  positionBreakdown: PositionBreakdownItem[];
}

// =============================================================================
// Service
// =============================================================================

export class NavSnapshotService {
  private static instance: NavSnapshotService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(deps?: NavSnapshotServiceDependencies) {
    this.prisma = (deps?.prisma ?? prismaClient) as PrismaClient;
    this.logger = createServiceLogger('NavSnapshotService');
  }

  static getInstance(deps?: NavSnapshotServiceDependencies): NavSnapshotService {
    if (!NavSnapshotService.instance) {
      NavSnapshotService.instance = new NavSnapshotService(deps);
    }
    return NavSnapshotService.instance;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Creates or updates (upserts) a NAV snapshot.
   * The unique constraint is (userId, snapshotDate, snapshotType).
   */
  async createSnapshot(input: CreateNavSnapshotInput): Promise<string> {
    const result = await this.prisma.nAVSnapshot.upsert({
      where: {
        userId_snapshotDate_snapshotType: {
          userId: input.userId,
          snapshotDate: input.snapshotDate,
          snapshotType: input.snapshotType,
        },
      },
      create: {
        userId: input.userId,
        snapshotDate: input.snapshotDate,
        snapshotType: input.snapshotType,
        reportingCurrency: input.reportingCurrency,
        valuationMethod: input.valuationMethod,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        netAssetValue: input.netAssetValue,
        depositedLiquidityAtCost: input.depositedLiquidityAtCost,
        markToMarketAdjustment: input.markToMarketAdjustment,
        unclaimedFees: input.unclaimedFees,
        contributedCapital: input.contributedCapital,
        capitalReturned: input.capitalReturned,
        retainedRealizedWithdrawals: input.retainedRealizedWithdrawals,
        retainedRealizedFees: input.retainedRealizedFees,
        retainedUnrealizedPrice: input.retainedUnrealizedPrice,
        retainedUnrealizedFees: input.retainedUnrealizedFees,
        activePositionCount: input.activePositionCount,
        positionBreakdown: input.positionBreakdown as unknown as object[],
      },
      update: {
        reportingCurrency: input.reportingCurrency,
        valuationMethod: input.valuationMethod,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        netAssetValue: input.netAssetValue,
        depositedLiquidityAtCost: input.depositedLiquidityAtCost,
        markToMarketAdjustment: input.markToMarketAdjustment,
        unclaimedFees: input.unclaimedFees,
        contributedCapital: input.contributedCapital,
        capitalReturned: input.capitalReturned,
        retainedRealizedWithdrawals: input.retainedRealizedWithdrawals,
        retainedRealizedFees: input.retainedRealizedFees,
        retainedUnrealizedPrice: input.retainedUnrealizedPrice,
        retainedUnrealizedFees: input.retainedUnrealizedFees,
        activePositionCount: input.activePositionCount,
        positionBreakdown: input.positionBreakdown as unknown as object[],
      },
      select: { id: true },
    });

    this.logger.info(
      `Created NAV snapshot for user ${input.userId} at ${input.snapshotDate.toISOString()}`
    );
    return result.id;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the most recent NAV snapshot for a user.
   */
  async getLatestSnapshot(userId: string) {
    return this.prisma.nAVSnapshot.findFirst({
      where: { userId },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  /**
   * Returns the closest snapshot on or before the given date.
   */
  async getSnapshotByDate(userId: string, date: Date) {
    return this.prisma.nAVSnapshot.findFirst({
      where: {
        userId,
        snapshotDate: { lte: date },
      },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  /**
   * Returns all snapshots within a date range, ordered by date ascending.
   */
  async getSnapshotRange(userId: string, startDate: Date, endDate: Date) {
    return this.prisma.nAVSnapshot.findMany({
      where: {
        userId,
        snapshotDate: { gte: startDate, lte: endDate },
      },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  /**
   * Returns the closest snapshot on or before the given date.
   * Used by the balance sheet endpoint to get the previous period snapshot.
   */
  async getSnapshotAtBoundary(userId: string, date: Date) {
    return this.prisma.nAVSnapshot.findFirst({
      where: {
        userId,
        snapshotDate: { lte: date },
      },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  /**
   * Returns the current (latest) and previous snapshot for period comparison.
   * Uses calendar-based period boundaries.
   */
  async getComparisonSnapshots(userId: string, period: CalendarPeriod) {
    const current = await this.getLatestSnapshot(userId);
    if (!current) return { current: null, previous: null };

    const { previousEnd } = getCalendarPeriodBoundaries(period);
    const previous = await this.getSnapshotAtBoundary(userId, previousEnd);

    return { current, previous };
  }
}
