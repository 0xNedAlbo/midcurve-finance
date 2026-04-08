/**
 * Backfill script: Populate ownerWallet for existing positions
 *
 * Run with: npx tsx prisma/backfill-owner-wallet.ts
 *
 * Idempotent — skips positions that already have an ownerWallet.
 *
 * Sources:
 * - uniswapv3: state.ownerAddress → "evm:{address}"
 * - uniswapv3-vault: config.userAddress → "evm:{address}"
 */

import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

async function main() {
  const positions = await prisma.position.findMany({
    where: { ownerWallet: null },
  });

  console.log(`Found ${positions.length} positions without ownerWallet`);

  let updated = 0;
  let skipped = 0;

  for (const position of positions) {
    let address: string | undefined;

    if (position.protocol === 'uniswapv3') {
      const state = position.state as Record<string, unknown>;
      address = state.ownerAddress as string | undefined;
    } else if (position.protocol === 'uniswapv3-vault') {
      const config = position.config as Record<string, unknown>;
      address = config.userAddress as string | undefined;
    }

    if (!address || !address.startsWith('0x') || address.length !== 42) {
      console.warn(`  Skipping position ${position.id} (protocol=${position.protocol}): no valid address found`);
      skipped++;
      continue;
    }

    const ownerWallet = `evm:${address}`;

    await prisma.position.update({
      where: { id: position.id },
      data: { ownerWallet },
    });

    updated++;
    console.log(`  Updated ${position.id} → ${ownerWallet}`);
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
