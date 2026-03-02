/**
 * SnapshotRetentionRule
 *
 * Runs daily at 2 AM UTC (1 hour after the daily snapshot job at 1 AM).
 * Applies a tiered retention policy to NAV snapshots:
 *
 * | Tier      | Granularity | Retention    | Max Snapshots |
 * |-----------|-------------|--------------|---------------|
 * | Daily     | 1 day       | 14 days      | 14            |
 * | Weekly    | 1 week      | 6 weeks      | 6             |
 * | Monthly   | 1 month     | 13 months    | 13            |
 * | Quarterly | 1 quarter   | 5 quarters   | 5             |
 * | Yearly    | 1 year      | Indefinite   | Unbounded     |
 *
 * When a snapshot ages out of its tier, it is either promoted to the next tier
 * (if it falls on the end-of-period stichtag) or deleted.
 *
 * Promotion stichtags (end-of-period representatives):
 * - Daily → Weekly: Sunday (day of week = 0)
 * - Weekly → Monthly: last Sunday of the month
 * - Monthly → Quarterly: last month of the quarter (month % 3 === 2)
 * - Quarterly → Yearly: Q4 (month >= 9)
 */

import { prisma } from '@midcurve/database';
import { BusinessRule } from '../base';
import { ruleLog } from '../../lib/logger';

type SnapshotType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export class SnapshotRetentionRule extends BusinessRule {
  readonly ruleName = 'snapshot-retention';
  readonly ruleDescription =
    'Applies tiered retention policy to NAV snapshots (daily → weekly → monthly → quarterly → yearly)';

  protected async onStartup(): Promise<void> {
    this.registerSchedule(
      '0 2 * * *', // 2 AM UTC — 1 hour after daily snapshot job
      'NAV snapshot retention policy',
      () => this.execute(),
      { timezone: 'UTC', runOnStart: false }
    );

    this.logger.info(
      { schedule: '0 2 * * * (UTC)' },
      'Registered snapshot retention schedule'
    );
  }

  protected async onShutdown(): Promise<void> {
    // Schedules auto-cleanup by base class
  }

  private async execute(): Promise<void> {
    ruleLog.eventProcessing(this.logger, this.ruleName, 'retention-sweep', 'all-users');
    const startTime = Date.now();

    // Get distinct user IDs that have snapshots
    const users = await prisma.nAVSnapshot.findMany({
      select: { userId: true },
      distinct: ['userId'],
    });

    let totalPromoted = 0;
    let totalDeleted = 0;

    for (const { userId } of users) {
      const result = await this.applyRetentionForUser(userId);
      totalPromoted += result.promoted;
      totalDeleted += result.deleted;
    }

    const durationMs = Date.now() - startTime;
    ruleLog.eventProcessed(this.logger, this.ruleName, 'retention-sweep', 'all-users', durationMs);

    this.logger.info(
      { userCount: users.length, totalPromoted, totalDeleted, durationMs },
      'Snapshot retention sweep completed'
    );
  }

  private async applyRetentionForUser(userId: string): Promise<{ promoted: number; deleted: number }> {
    const now = new Date();
    let promoted = 0;
    let deleted = 0;

    // Process each tier from finest to coarsest
    const dailyResult = await this.processTier(userId, 'daily', 14, now, 'weekly', isSunday);
    promoted += dailyResult.promoted;
    deleted += dailyResult.deleted;

    const weeklyResult = await this.processTier(userId, 'weekly', 42, now, 'monthly', isLastSundayOfMonth);
    promoted += weeklyResult.promoted;
    deleted += weeklyResult.deleted;

    const monthlyResult = await this.processTier(userId, 'monthly', 395, now, 'quarterly', isLastMonthOfQuarter);
    promoted += monthlyResult.promoted;
    deleted += monthlyResult.deleted;

    const quarterlyResult = await this.processTier(userId, 'quarterly', 456, now, 'yearly', isQ4);
    promoted += quarterlyResult.promoted;
    deleted += quarterlyResult.deleted;

    // Yearly: never deleted
    return { promoted, deleted };
  }

  /**
   * For a given tier, find snapshots older than the retention window.
   * Promote snapshots that fall on the stichtag, delete the rest.
   */
  private async processTier(
    userId: string,
    tierType: SnapshotType,
    retentionDays: number,
    now: Date,
    promoteTo: SnapshotType,
    isStichtag: (date: Date) => boolean
  ): Promise<{ promoted: number; deleted: number }> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const expiredSnapshots = await prisma.nAVSnapshot.findMany({
      where: {
        userId,
        snapshotType: tierType,
        snapshotDate: { lt: cutoff },
      },
      select: { id: true, snapshotDate: true, snapshotType: true },
      orderBy: { snapshotDate: 'asc' },
    });

    let promoted = 0;
    let deleted = 0;

    for (const snapshot of expiredSnapshots) {
      if (isStichtag(snapshot.snapshotDate)) {
        // Promote: update snapshotType to next tier
        await prisma.nAVSnapshot.update({
          where: { id: snapshot.id },
          data: { snapshotType: promoteTo },
        });
        promoted++;
      } else {
        // Delete: cascade-deletes SnapshotStateCache rows
        await prisma.nAVSnapshot.delete({
          where: { id: snapshot.id },
        });
        deleted++;
      }
    }

    if (promoted > 0 || deleted > 0) {
      this.logger.info(
        { userId, tier: tierType, promoted, deleted },
        `Retention applied for tier ${tierType}`
      );
    }

    return { promoted, deleted };
  }
}

// =============================================================================
// Stichtag (end-of-period) Predicates
// =============================================================================

/** Sunday = end-of-week stichtag for daily → weekly promotion */
function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

/** Last Sunday of the month = stichtag for weekly → monthly promotion */
function isLastSundayOfMonth(date: Date): boolean {
  if (date.getUTCDay() !== 0) return false;
  // Check if next Sunday would be in a different month
  const nextSunday = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
  return nextSunday.getUTCMonth() !== date.getUTCMonth();
}

/** Last month of a quarter (March, June, September, December) = stichtag for monthly → quarterly */
function isLastMonthOfQuarter(date: Date): boolean {
  return date.getUTCMonth() % 3 === 2; // months 2, 5, 8, 11
}

/** Q4 (October, November, December) = stichtag for quarterly → yearly */
function isQ4(date: Date): boolean {
  return date.getUTCMonth() >= 9; // months 9, 10, 11
}
