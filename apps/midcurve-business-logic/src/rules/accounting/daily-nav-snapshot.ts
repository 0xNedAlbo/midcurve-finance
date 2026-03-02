/**
 * DailyNavSnapshotRule
 *
 * Thin cron wrapper that delegates to NavSnapshotService.generateSnapshot().
 * Runs at 1 AM UTC daily to allow The Graph subgraph indexing to catch up past midnight.
 */

import { NavSnapshotService } from '@midcurve/services';
import { BusinessRule } from '../base';
import { ruleLog } from '../../lib/logger';

export class DailyNavSnapshotRule extends BusinessRule {
  readonly ruleName = 'daily-nav-snapshot';
  readonly ruleDescription =
    'Refreshes active positions via subgraph and creates daily NAV snapshots with reporting currency';

  private readonly navSnapshotService: NavSnapshotService;

  constructor() {
    super();
    this.navSnapshotService = NavSnapshotService.getInstance();
  }

  protected async onStartup(): Promise<void> {
    this.registerSchedule(
      '0 1 * * *', // 1 AM UTC — allows subgraph indexing to catch up past midnight
      'Daily NAV snapshot and position refresh',
      () => this.execute(),
      { timezone: 'UTC', runOnStart: false }
    );

    this.logger.info(
      { schedule: '0 1 * * * (UTC)' },
      'Registered daily NAV snapshot schedule'
    );
  }

  protected async onShutdown(): Promise<void> {
    // Schedules auto-cleanup by base class
  }

  private async execute(): Promise<void> {
    ruleLog.eventProcessing(this.logger, this.ruleName, 'daily-snapshot', 'all-users');
    const startTime = Date.now();

    await this.navSnapshotService.generateSnapshot();

    const durationMs = Date.now() - startTime;
    ruleLog.eventProcessed(this.logger, this.ruleName, 'daily-snapshot', 'all-users', durationMs);
  }
}
