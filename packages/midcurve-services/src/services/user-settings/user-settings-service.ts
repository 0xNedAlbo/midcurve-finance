/**
 * User Settings Service
 *
 * Thin CRUD layer for per-user settings stored as a single JSON structure.
 * One UserSettings row per user, with a settings JSON column typed as UserSettingsData.
 *
 * Methods:
 * - getByUserId: Get settings for a user (returns defaults if no row exists)
 * - upsert: Create or replace entire settings JSON
 * - addFavoritePoolEntry: Prepend a favorite pool entry (idempotent, optionally pinning isToken0Quote)
 * - removeFavoritePoolEntry: Remove a favorite by pool hash (idempotent)
 * - getFavoritePoolEntries: Get the user's favorite pool entries
 * - isFavoritePoolHash: Check if a pool hash is in the user's favorites
 *
 * Storage compatibility: legacy installations stored `favoritePoolHashes`
 * as `string[]`. Reads normalize legacy entries to `FavoritePoolEntry`
 * on the fly; writes always emit the object shape.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import { DEFAULT_USER_SETTINGS, POOL_TABLE_COLUMN_IDS } from '@midcurve/shared';
import type {
  FavoritePoolEntry,
  PoolTableColumnId,
  UserSettingsData,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Dependencies for UserSettingsService
 */
export interface UserSettingsServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * Normalize a single stored entry into `FavoritePoolEntry`.
 *
 * Accepts either the legacy `string` shape or the new object shape.
 */
function normalizeEntry(raw: unknown): FavoritePoolEntry | null {
  if (typeof raw === 'string') {
    return { hash: raw };
  }
  if (raw && typeof raw === 'object' && 'hash' in raw && typeof (raw as { hash: unknown }).hash === 'string') {
    const obj = raw as { hash: string; isToken0Quote?: unknown };
    if (typeof obj.isToken0Quote === 'boolean') {
      return { hash: obj.hash, isToken0Quote: obj.isToken0Quote };
    }
    return { hash: obj.hash };
  }
  return null;
}

/**
 * Normalize the raw `favoritePoolHashes` JSON value into `FavoritePoolEntry[]`.
 * Drops malformed entries silently — they have no place in the typed runtime.
 */
function normalizeEntries(raw: unknown): FavoritePoolEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: FavoritePoolEntry[] = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry) result.push(entry);
  }
  return result;
}

/**
 * Normalize the raw `poolTableVisibleColumns` JSON value into a typed array.
 *
 * - Falls back to defaults when the stored value is missing or not an array
 *   (covers legacy rows predating this field).
 * - Drops unknown ids silently — schema may have removed columns since the
 *   row was written.
 * - De-duplicates while preserving first occurrence.
 */
function normalizeColumns(raw: unknown): PoolTableColumnId[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_USER_SETTINGS.poolTableVisibleColumns];
  }
  const known = new Set<string>(POOL_TABLE_COLUMN_IDS);
  const seen = new Set<PoolTableColumnId>();
  const result: PoolTableColumnId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!known.has(item)) continue;
    const id = item as PoolTableColumnId;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * User Settings Service
 *
 * Manages per-user settings stored as a single JSON structure.
 */
export class UserSettingsService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: UserSettingsServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('UserSettingsService');
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Gets settings for a user.
   *
   * Normalizes the stored `favoritePoolHashes` JSON (which may be a legacy
   * `string[]`) into `FavoritePoolEntry[]` before returning.
   *
   * @returns The user's settings, or DEFAULT_USER_SETTINGS if no row exists
   */
  async getByUserId(userId: string): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'getByUserId', { userId });

    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!row) {
      log.methodExit(this.logger, 'getByUserId', { found: false });
      return { ...DEFAULT_USER_SETTINGS };
    }

    const raw = row.settings as unknown as Record<string, unknown>;
    const settings: UserSettingsData = {
      ...DEFAULT_USER_SETTINGS,
      ...(raw as Partial<UserSettingsData>),
      favoritePoolHashes: normalizeEntries(raw.favoritePoolHashes),
      poolTableVisibleColumns: normalizeColumns(raw.poolTableVisibleColumns),
    };

    log.methodExit(this.logger, 'getByUserId', { found: true });
    return settings;
  }

  /**
   * Creates or replaces the entire settings JSON for a user.
   */
  async upsert(
    userId: string,
    settings: UserSettingsData
  ): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'upsert', { userId });

    const settingsJson = settings as unknown as Prisma.InputJsonValue;

    const result = await this.prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        settings: settingsJson,
      },
      update: {
        settings: settingsJson,
      },
    });

    const raw = result.settings as unknown as Record<string, unknown>;
    const normalized: UserSettingsData = {
      ...DEFAULT_USER_SETTINGS,
      ...(raw as Partial<UserSettingsData>),
      favoritePoolHashes: normalizeEntries(raw.favoritePoolHashes),
      poolTableVisibleColumns: normalizeColumns(raw.poolTableVisibleColumns),
    };

    log.methodExit(this.logger, 'upsert', { userId });
    return normalized;
  }

  // ============================================================================
  // FAVORITE POOL ENTRY OPERATIONS
  // ============================================================================

  /**
   * Prepends a favorite pool entry to the user's favorites (idempotent).
   *
   * If an entry with the same `hash` already exists, it is removed first and
   * the new entry — including the (possibly updated) `isToken0Quote` — is
   * prepended. Always writes the new object shape, regardless of whether the
   * caller provided an orientation.
   */
  async addFavoritePoolEntry(
    userId: string,
    hash: string,
    isToken0Quote?: boolean
  ): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'addFavoritePoolEntry', {
      userId,
      hash,
      isToken0Quote,
    });

    const current = await this.getByUserId(userId);
    const filtered = current.favoritePoolHashes.filter((e) => e.hash !== hash);
    const newEntry: FavoritePoolEntry =
      typeof isToken0Quote === 'boolean'
        ? { hash, isToken0Quote }
        : { hash };
    const updated: UserSettingsData = {
      ...current,
      favoritePoolHashes: [newEntry, ...filtered],
    };

    const result = await this.upsert(userId, updated);
    log.methodExit(this.logger, 'addFavoritePoolEntry', {
      totalFavorites: result.favoritePoolHashes.length,
    });
    return result;
  }

  /**
   * Removes a favorite pool entry by hash (idempotent).
   */
  async removeFavoritePoolEntry(
    userId: string,
    hash: string
  ): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'removeFavoritePoolEntry', { userId, hash });

    const current = await this.getByUserId(userId);
    const updated: UserSettingsData = {
      ...current,
      favoritePoolHashes: current.favoritePoolHashes.filter(
        (e) => e.hash !== hash
      ),
    };

    const result = await this.upsert(userId, updated);
    log.methodExit(this.logger, 'removeFavoritePoolEntry', {
      totalFavorites: result.favoritePoolHashes.length,
    });
    return result;
  }

  /**
   * Returns the user's favorite pool entries (lazy-normalized from storage).
   */
  async getFavoritePoolEntries(userId: string): Promise<FavoritePoolEntry[]> {
    const settings = await this.getByUserId(userId);
    return settings.favoritePoolHashes;
  }

  /**
   * Checks if a pool hash is in the user's favorites.
   */
  async isFavoritePoolHash(
    userId: string,
    poolHash: string
  ): Promise<boolean> {
    const entries = await this.getFavoritePoolEntries(userId);
    return entries.some((e) => e.hash === poolHash);
  }

  // ============================================================================
  // POOL TABLE VISIBLE COLUMNS OPERATIONS
  // ============================================================================

  /**
   * Returns the user's visible pool-table columns (lazy-defaulted from storage).
   */
  async getPoolTableVisibleColumns(
    userId: string
  ): Promise<PoolTableColumnId[]> {
    const settings = await this.getByUserId(userId);
    return settings.poolTableVisibleColumns;
  }

  /**
   * Replaces the user's visible pool-table columns.
   *
   * Drops unknown ids and de-duplicates before persisting.
   */
  async updatePoolTableVisibleColumns(
    userId: string,
    columns: readonly string[]
  ): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'updatePoolTableVisibleColumns', {
      userId,
      columnCount: columns.length,
    });

    const normalized = normalizeColumns(columns);
    const current = await this.getByUserId(userId);
    const updated: UserSettingsData = {
      ...current,
      poolTableVisibleColumns: normalized,
    };

    const result = await this.upsert(userId, updated);
    log.methodExit(this.logger, 'updatePoolTableVisibleColumns', {
      columnCount: result.poolTableVisibleColumns.length,
    });
    return result;
  }
}
