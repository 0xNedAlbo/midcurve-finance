/**
 * Seed script for the Phase 1 Chart of Accounts.
 *
 * Upserts all 11 account definitions so the script is idempotent —
 * safe to run multiple times without duplicating rows.
 *
 * Usage: npx tsx prisma/seed-accounts.ts
 */

import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const PHASE1_ACCOUNTS = [
  // Assets (1xxx)
  {
    code: 1000,
    name: 'LP Position at Cost',
    description:
      'Cost basis of active positions. Debited on open/increase, credited on close/decrease.',
    category: 'asset',
    normalSide: 'debit',
  },
  {
    code: 1001,
    name: 'LP Position Unrealized Adjustment',
    description:
      'Mark-to-market adjustment above/below cost. Net of 1000 + 1001 = fair value.',
    category: 'asset',
    normalSide: 'debit',
  },
  {
    code: 1002,
    name: 'Accrued Fee Income',
    description:
      'Unclaimed fees on active positions. Debited as fees accrue, credited when collected.',
    category: 'asset',
    normalSide: 'debit',
  },
  // Equity (3xxx)
  {
    code: 3000,
    name: 'Contributed Capital',
    description: 'Total capital invested into positions (subscriptions).',
    category: 'equity',
    normalSide: 'credit',
  },
  {
    code: 3100,
    name: 'Capital Returned',
    description: 'Total capital returned from closed positions and collected fees (redemptions).',
    category: 'equity',
    normalSide: 'debit',
  },
  // Revenue (4xxx)
  {
    code: 4000,
    name: 'Fee Income',
    description: 'LP fees earned (accrued at M2M time, resolved at collection time).',
    category: 'revenue',
    normalSide: 'credit',
  },
  {
    code: 4100,
    name: 'Realized Gains',
    description: 'Gains crystallized upon position decrease or close.',
    category: 'revenue',
    normalSide: 'credit',
  },
  {
    code: 4200,
    name: 'Unrealized Gains',
    description: 'Positive mark-to-market changes on open positions.',
    category: 'revenue',
    normalSide: 'credit',
  },
  // Expenses (5xxx)
  {
    code: 5000,
    name: 'Realized Losses',
    description: 'Losses crystallized upon position decrease or close.',
    category: 'expense',
    normalSide: 'debit',
  },
  {
    code: 5100,
    name: 'Gas Expense',
    description: 'On-chain transaction costs (when data is available).',
    category: 'expense',
    normalSide: 'debit',
  },
  {
    code: 5200,
    name: 'Unrealized Losses',
    description: 'Negative mark-to-market changes on open positions.',
    category: 'expense',
    normalSide: 'debit',
  },
] as const;

async function main() {
  console.log('Seeding Phase 1 Chart of Accounts...');

  for (const account of PHASE1_ACCOUNTS) {
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

  console.log(`\nSeeded ${PHASE1_ACCOUNTS.length} accounts.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
