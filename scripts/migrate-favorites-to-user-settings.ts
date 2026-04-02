/**
 * One-time Migration Script: FavoritePool → UserSettings
 *
 * Migrates favorite pools from the favorite_pools table
 * into the UserSettings JSON structure (favoritePoolHashes array).
 *
 * IMPORTANT: Run this BEFORE applying the remove_favorite_pools_table migration.
 * This script uses raw SQL since the FavoritePool Prisma model has been removed.
 *
 * Usage:
 *   npx tsx scripts/migrate-favorites-to-user-settings.ts
 *
 * Prerequisites:
 *   - The user_settings table must exist (migration 20260402120000_add_user_settings applied)
 *   - The favorite_pools table must still exist (migration 20260402120100 NOT yet applied)
 *
 * This script is idempotent — running it multiple times will not create duplicates.
 */

import { PrismaClient } from '@midcurve/database';
import type { UserSettingsData } from '@midcurve/shared';
import { DEFAULT_USER_SETTINGS } from '@midcurve/shared';

const prisma = new PrismaClient();

interface FavoriteRow {
  userId: string;
  poolHash: string | null;
  poolId: string;
  createdAt: Date;
}

async function main() {
  console.log('Starting FavoritePool → UserSettings migration...\n');

  // 1. Check if favorite_pools table exists
  const tableCheck = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'favorite_pools'
    )
  `;

  if (!tableCheck[0]?.exists) {
    console.log('favorite_pools table does not exist. Nothing to migrate.');
    return;
  }

  // 2. Fetch all favorites with their pool's poolHash using raw SQL
  const favorites = await prisma.$queryRaw<FavoriteRow[]>`
    SELECT fp."userId", p."poolHash", fp."poolId", fp."createdAt"
    FROM "public"."favorite_pools" fp
    JOIN "public"."pools" p ON fp."poolId" = p."id"
    ORDER BY fp."createdAt" DESC
  `;

  console.log(`Found ${favorites.length} favorite records total.`);

  // 3. Check for pools with null poolHash
  const nullHashFavorites = favorites.filter((f) => !f.poolHash);
  if (nullHashFavorites.length > 0) {
    console.error(
      `\nERROR: ${nullHashFavorites.length} favorite(s) reference pools with null poolHash.`
    );
    console.error('Pool IDs with null hash:');
    for (const f of nullHashFavorites) {
      console.error(`  - poolId: ${f.poolId}`);
    }
    console.error('\nPlease backfill poolHash on these pools before running this migration.');
    process.exit(1);
  }

  // 4. Group by userId, preserving most-recent-first order
  const userFavorites = new Map<string, string[]>();
  for (const fav of favorites) {
    const poolHash = fav.poolHash!;
    if (!userFavorites.has(fav.userId)) {
      userFavorites.set(fav.userId, []);
    }
    const hashes = userFavorites.get(fav.userId)!;
    if (!hashes.includes(poolHash)) {
      hashes.push(poolHash);
    }
  }

  console.log(`Migrating favorites for ${userFavorites.size} user(s).\n`);

  // 5. Upsert UserSettings for each user
  let migratedCount = 0;

  for (const [userId, poolHashes] of userFavorites) {
    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (existing) {
      const existingSettings = existing.settings as unknown as UserSettingsData;
      const existingSet = new Set(existingSettings.favoritePoolHashes);
      const newHashes = poolHashes.filter((h) => !existingSet.has(h));

      if (newHashes.length === 0) {
        console.log(`  User ${userId}: already has all ${poolHashes.length} favorites, skipping.`);
        continue;
      }

      const merged: UserSettingsData = {
        ...existingSettings,
        favoritePoolHashes: [...newHashes, ...existingSettings.favoritePoolHashes],
      };

      await prisma.userSettings.update({
        where: { userId },
        data: { settings: merged as unknown as Record<string, unknown> },
      });

      console.log(
        `  User ${userId}: merged ${newHashes.length} new favorites (${merged.favoritePoolHashes.length} total).`
      );
    } else {
      const settings: UserSettingsData = {
        ...DEFAULT_USER_SETTINGS,
        favoritePoolHashes: poolHashes,
      };

      await prisma.userSettings.create({
        data: {
          userId,
          settings: settings as unknown as Record<string, unknown>,
        },
      });

      console.log(`  User ${userId}: created settings with ${poolHashes.length} favorites.`);
    }

    migratedCount++;
  }

  // 6. Verification
  const totalSettingsRows = await prisma.userSettings.count();
  console.log(`\nMigration complete.`);
  console.log(`  Favorites migrated: ${favorites.length}`);
  console.log(`  Users processed: ${migratedCount}`);
  console.log(`  Total UserSettings rows: ${totalSettingsRows}`);
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
