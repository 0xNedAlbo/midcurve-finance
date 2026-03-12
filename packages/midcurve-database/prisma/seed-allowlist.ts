/**
 * Seed script for the admin allowlist entry.
 *
 * Reads ADMIN_WALLET_ADDRESS env var and upserts into
 * user_allow_list_entries so the admin can sign in on first boot.
 *
 * Idempotent — safe to run multiple times without duplicating rows.
 * Skips gracefully if ADMIN_WALLET_ADDRESS is not set.
 *
 * Usage: ADMIN_WALLET_ADDRESS=0x... npx tsx prisma/seed-allowlist.ts
 */

import { getAddress, isAddress } from 'viem';
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

async function main() {
  const rawAddress = process.env.ADMIN_WALLET_ADDRESS;

  if (!rawAddress) {
    console.log(
      'ADMIN_WALLET_ADDRESS not set — skipping allowlist seed.',
    );
    return;
  }

  if (!isAddress(rawAddress)) {
    console.error(
      `Invalid ADMIN_WALLET_ADDRESS: ${rawAddress} (must be 0x + 40 hex chars)`,
    );
    process.exit(1);
  }

  const address = getAddress(rawAddress);

  console.log('Seeding allowlist...');

  await prisma.userAllowListEntry.upsert({
    where: { address },
    update: {},
    create: { address, note: 'admin' },
  });

  console.log(`  + ${address} (admin)`);
  console.log('\nAllowlist seeded.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
