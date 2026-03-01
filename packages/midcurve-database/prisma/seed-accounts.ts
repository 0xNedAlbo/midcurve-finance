/**
 * Seed script for the Chart of Accounts.
 *
 * Upserts all account definitions so the script is idempotent —
 * safe to run multiple times without duplicating rows.
 *
 * Account definitions are sourced from @midcurve/shared (single source of truth).
 * The business logic worker also seeds on startup via JournalService.ensureChartOfAccounts().
 *
 * Usage: npx tsx prisma/seed-accounts.ts
 */

import { PrismaClient } from '../src/generated/prisma/index.js';
import { CHART_OF_ACCOUNTS } from '@midcurve/shared';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Chart of Accounts...');

  for (const account of CHART_OF_ACCOUNTS) {
    await prisma.accountDefinition.upsert({
      where: { code: account.code },
      update: {
        name: account.name,
        description: account.description,
        category: account.category,
        normalSide: account.normalSide,
      },
      create: {
        code: account.code,
        name: account.name,
        description: account.description,
        category: account.category,
        normalSide: account.normalSide,
      },
    });
    console.log(`  ✓ ${account.code} ${account.name}`);
  }

  console.log(`\nSeeded ${CHART_OF_ACCOUNTS.length} accounts.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
