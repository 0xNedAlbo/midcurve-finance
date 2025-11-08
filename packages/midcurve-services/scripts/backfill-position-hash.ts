/**
 * Backfill positionHash for existing positions
 *
 * This script populates the positionHash field for all existing positions
 * in the database. Run this after adding the positionHash field to the schema.
 *
 * Usage:
 *   npm run backfill:position-hash
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillPositionHash() {
  console.log('Starting positionHash backfill...\n');

  // Get all positions without positionHash
  const positions = await prisma.position.findMany({
    where: {
      positionHash: null,
    },
    select: {
      id: true,
      protocol: true,
      config: true,
    },
  });

  console.log(`Found ${positions.length} positions to backfill\n`);

  if (positions.length === 0) {
    console.log('No positions need backfilling. All done!');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const position of positions) {
    try {
      let positionHash: string;

      // Generate hash based on protocol
      if (position.protocol === 'uniswapv3') {
        const config = position.config as { chainId: number; nftId: number };
        positionHash = `uniswapv3/${config.chainId}/${config.nftId}`;
      } else {
        console.warn(`Unknown protocol: ${position.protocol}, skipping position ${position.id}`);
        continue;
      }

      // Update position
      await prisma.position.update({
        where: { id: position.id },
        data: { positionHash },
      });

      updated++;

      // Progress indicator every 10 positions
      if (updated % 10 === 0) {
        console.log(`Progress: ${updated}/${positions.length} positions updated`);
      }
    } catch (error) {
      console.error(`Error updating position ${position.id}:`, error);
      errors++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Backfill complete:');
  console.log(`  ✓ Updated: ${updated}`);
  console.log(`  ✗ Errors:  ${errors}`);
  console.log(`  Total:     ${positions.length}`);
  console.log('='.repeat(60));
}

backfillPositionHash()
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
