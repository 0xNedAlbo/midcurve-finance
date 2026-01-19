#!/usr/bin/env npx tsx

/**
 * Reset Local Chain Database Script
 *
 * This script cleans up database records that reference the local blockchain (chainId 31337)
 * after the chain has been reset. It:
 * - Deletes all local chain positions (cascades to ledger events, APR periods, etc.)
 * - Deletes all local chain automation orders
 * - Deletes all local chain pools (cascades to pool prices, subscriptions)
 * - Updates the mockUSD token address to the new deployment
 *
 * Usage:
 *   pnpm db:reset-local [--mock-usd 0xNEW_ADDRESS] [--dry-run]
 *
 * The mockUSD address can be provided via:
 *   1. CLI argument: --mock-usd 0x...
 *   2. Environment variable: MOCK_USD_ADDRESS (set by local:setup)
 */

import { prisma } from '@midcurve/database';
import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env file manually (no dotenv dependency)
function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const LOCAL_CHAIN_ID = 31337;

interface ResetOptions {
  mockUsdAddress: string;
  dryRun: boolean;
}

async function resetLocalChainDb(options: ResetOptions) {
  const { mockUsdAddress, dryRun } = options;

  console.log(`\n🔄 Resetting local chain database (chainId: ${LOCAL_CHAIN_ID})`);
  console.log(`   New mockUSD address: ${mockUsdAddress}`);
  if (dryRun) console.log('   DRY RUN - no changes will be made\n');

  // 1. Find local chain pools
  const localPools = await prisma.pool.findMany({
    where: {
      config: { path: ['chainId'], equals: LOCAL_CHAIN_ID },
    },
    select: { id: true, config: true },
  });
  console.log(`📊 Found ${localPools.length} local pools`);

  // 2. Find local chain positions
  const localPositions = await prisma.position.findMany({
    where: {
      config: { path: ['chainId'], equals: LOCAL_CHAIN_ID },
    },
    select: { id: true, positionHash: true },
  });
  console.log(`📊 Found ${localPositions.length} local positions`);

  // 3. Find local chain automation orders
  const localOrders = await prisma.automationCloseOrder.findMany({
    where: {
      automationContractConfig: { path: ['chainId'], equals: LOCAL_CHAIN_ID },
    },
    select: { id: true, status: true },
  });
  console.log(`📊 Found ${localOrders.length} local automation orders`);

  // 4. Find mockUSD token to patch
  const mockUsdToken = await prisma.token.findFirst({
    where: {
      symbol: 'mockUSD',
      config: { path: ['chainId'], equals: LOCAL_CHAIN_ID },
    },
  });
  console.log(`📊 Found mockUSD token: ${mockUsdToken?.id ?? 'NOT FOUND'}`);

  if (dryRun) {
    console.log('\n✅ Dry run complete - no changes made');
    return;
  }

  // Execute deletions in correct order (respecting foreign keys)
  await prisma.$transaction(async (tx) => {
    // Delete automation orders first (references positions)
    if (localOrders.length > 0) {
      const deleted = await tx.automationCloseOrder.deleteMany({
        where: { id: { in: localOrders.map((o) => o.id) } },
      });
      console.log(`🗑️  Deleted ${deleted.count} automation orders`);
    }

    // Delete positions (cascades: ledger events, APR periods, sync state, logs, range status)
    if (localPositions.length > 0) {
      const deleted = await tx.position.deleteMany({
        where: { id: { in: localPositions.map((p) => p.id) } },
      });
      console.log(`🗑️  Deleted ${deleted.count} positions (+ cascaded records)`);
    }

    // Delete pools (cascades: pool prices, price subscriptions)
    if (localPools.length > 0) {
      const poolIds = localPools.map((p) => p.id);
      const deletedPools = await tx.pool.deleteMany({
        where: { id: { in: poolIds } },
      });
      console.log(`🗑️  Deleted ${deletedPools.count} pools (+ prices, subscriptions)`);
    }

    // Patch mockUSD token address
    if (mockUsdToken) {
      const currentConfig = mockUsdToken.config as { address: string; chainId: number };
      await tx.token.update({
        where: { id: mockUsdToken.id },
        data: {
          config: {
            ...currentConfig,
            address: mockUsdAddress,
          },
        },
      });
      console.log(`✏️  Updated mockUSD address: ${currentConfig.address} → ${mockUsdAddress}`);
    } else {
      console.log(`⚠️  mockUSD token not found - skipping address update`);
    }
  });

  console.log('\n✅ Local chain database reset complete');
}

// CLI entry point
async function main() {
  const { values } = parseArgs({
    options: {
      'mock-usd': { type: 'string', short: 'm' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });

  // Get mockUSD address from CLI arg or environment variable
  const mockUsdAddress = values['mock-usd'] || process.env.MOCK_USD_ADDRESS;

  if (values.help) {
    console.log(`
Usage: npx tsx scripts/reset-local-chain-db.ts [--mock-usd <address>] [--dry-run]

Options:
  -m, --mock-usd <address>  New mockUSD contract address
                            (defaults to MOCK_USD_ADDRESS env var)
  --dry-run                 Show what would be deleted without making changes
  -h, --help                Show this help message

Environment Variables:
  MOCK_USD_ADDRESS          Set by 'pnpm local:setup', used if --mock-usd not provided

Example:
  pnpm db:reset-local                           # Uses MOCK_USD_ADDRESS from .env
  pnpm db:reset-local --mock-usd 0x1234...abcd  # Override with specific address
  pnpm db:reset-local --dry-run                 # Preview changes without executing
`);
    process.exit(0);
  }

  if (!mockUsdAddress) {
    console.error('Error: mockUSD address not provided.');
    console.error('');
    console.error('Provide it via:');
    console.error('  1. CLI argument: --mock-usd 0x...');
    console.error('  2. Environment variable: MOCK_USD_ADDRESS');
    console.error('     (automatically set by: pnpm local:setup)');
    console.error('');
    console.error('Run with --help for more information.');
    process.exit(1);
  }

  await resetLocalChainDb({
    mockUsdAddress,
    dryRun: values['dry-run'] ?? false,
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
