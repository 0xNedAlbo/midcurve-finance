/**
 * Seed script for CoinGecko token lookup table.
 *
 * Loads pre-exported token data from seed-data/coingecko-tokens.json
 * and upserts into coingecko_tokens table. Only seeds base fields
 * (id, coingeckoId, name, symbol, config) — enrichment data
 * (imageUrl, marketCapUsd) is populated by the scheduled enrichment job.
 *
 * Idempotent — safe to run multiple times without duplicating rows.
 *
 * Usage: npx tsx prisma/seed-coingecko-tokens.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const BATCH_SIZE = 500;

interface TokenSeedEntry {
  id: string;
  coingeckoId: string;
  name: string;
  symbol: string;
  config: { chainId: number; tokenAddress: string };
}

async function main() {
  const existingCount = await prisma.coingeckoToken.count();
  if (existingCount > 0) {
    console.log(`CoinGecko tokens already seeded (${existingCount} rows), skipping.`);
    return;
  }

  console.log('Seeding CoinGecko tokens...');

  const seedPath = resolve(
    process.cwd(),
    'packages/midcurve-database/prisma/seed-data/coingecko-tokens.json',
  );
  const tokens: TokenSeedEntry[] = JSON.parse(
    readFileSync(seedPath, 'utf-8'),
  );

  console.log(`  Loaded ${tokens.length} tokens from seed file.`);

  let seeded = 0;
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);

    await prisma.$transaction(
      batch.map((token) =>
        prisma.coingeckoToken.upsert({
          where: { id: token.id },
          update: {
            coingeckoId: token.coingeckoId,
            name: token.name,
            symbol: token.symbol,
            config: token.config,
          },
          create: {
            id: token.id,
            coingeckoId: token.coingeckoId,
            name: token.name,
            symbol: token.symbol,
            config: token.config,
          },
        }),
      ),
    );

    seeded += batch.length;
    console.log(
      `  Processed ${seeded}/${tokens.length} tokens...`,
    );
  }

  console.log(`\nSeeded ${seeded} CoinGecko tokens.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
