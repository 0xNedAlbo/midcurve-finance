/**
 * Backfill script: Populate tokenHash for existing tokens
 *
 * Run with: npx tsx prisma/backfill-token-hash.ts
 *
 * Idempotent — skips tokens that already have a tokenHash.
 */

import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

function normalizeAddress(address: string): string {
  // Simple EIP-55 checksum via viem would be ideal, but for backfill
  // we trust that existing addresses are already normalized (the service
  // normalizes on create). Just ensure it starts with 0x.
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error(`Invalid address: ${address}`);
  }
  return address;
}

async function main() {
  const tokens = await prisma.token.findMany({
    where: { tokenHash: null },
  });

  console.log(`Found ${tokens.length} tokens without tokenHash`);

  let updated = 0;
  let skipped = 0;

  for (const token of tokens) {
    const config = token.config as Record<string, unknown>;
    let tokenHash: string;

    if (token.tokenType === 'erc20') {
      const address = config.address as string;
      const chainId = config.chainId as number;

      if (!address || !chainId) {
        console.warn(`Skipping token ${token.id} (${token.symbol}): missing address or chainId in config`);
        skipped++;
        continue;
      }

      tokenHash = `erc20/${chainId}/${normalizeAddress(address)}`;
    } else if (token.tokenType === 'basic-currency') {
      const currencyCode = config.currencyCode as string;

      if (!currencyCode) {
        console.warn(`Skipping token ${token.id} (${token.symbol}): missing currencyCode in config`);
        skipped++;
        continue;
      }

      tokenHash = `basic-currency/${currencyCode.toUpperCase()}`;
    } else {
      console.warn(`Skipping token ${token.id}: unknown tokenType "${token.tokenType}"`);
      skipped++;
      continue;
    }

    await prisma.token.update({
      where: { id: token.id },
      data: { tokenHash },
    });

    console.log(`  Updated ${token.symbol} (${token.id}) → ${tokenHash}`);
    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
