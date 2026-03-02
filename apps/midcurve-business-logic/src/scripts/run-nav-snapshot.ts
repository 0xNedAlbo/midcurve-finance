/**
 * Manual NAV Snapshot Script
 *
 * Usage:
 *   pnpm --filter '*business-logic*' nav-snapshot 2026-03-01 [userId]
 *
 * Arguments:
 *   date    - Snapshot date in YYYY-MM-DD format (required)
 *   userId  - User ID to snapshot (optional, defaults to all users)
 */

import { NavSnapshotService } from '@midcurve/services';

const [dateArg, userId] = process.argv.slice(2);

if (!dateArg) {
  console.error('Usage: run-nav-snapshot.ts <YYYY-MM-DD> [userId]');
  process.exit(1);
}

const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(dateArg);
if (!dateMatch) {
  console.error(`Invalid date format: "${dateArg}". Expected YYYY-MM-DD.`);
  process.exit(1);
}

const snapshotDate = new Date(`${dateArg}T00:00:00.000Z`);
if (isNaN(snapshotDate.getTime())) {
  console.error(`Invalid date: "${dateArg}"`);
  process.exit(1);
}

console.log(`Generating NAV snapshot for ${dateArg}${userId ? ` (user: ${userId})` : ' (all users)'}...`);

const service = NavSnapshotService.getInstance();
await service.generateSnapshot({ snapshotDate, userId });

console.log('Done.');
process.exit(0);
