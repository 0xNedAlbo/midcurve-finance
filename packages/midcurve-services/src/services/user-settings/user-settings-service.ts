/**
 * User Settings Service
 *
 * Thin CRUD layer for per-user settings stored as a single JSON structure.
 * One UserSettings row per user, with a settings JSON column typed as UserSettingsData.
 *
 * Methods:
 * - getByUserId: Get settings for a user (returns defaults if no row exists)
 * - upsert: Create or replace entire settings JSON
 * - addFavoritePoolHash: Prepend a pool hash to favorites (idempotent)
 * - removeFavoritePoolHash: Remove a pool hash from favorites (idempotent)
 * - getFavoritePoolHashes: Get the user's favorite pool hashes
 * - isFavoritePoolHash: Check if a pool hash is in the user's favorites
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import { DEFAULT_USER_SETTINGS } from '@midcurve/shared';
import type { UserSettingsData } from '@midcurve/shared';
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
 * User Settings Service
 *
 * Manages per-user settings stored as a single JSON structure.
 * Follows the WebhookConfigService 1:1 pattern.
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
   * Gets settings for a user
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

    log.methodExit(this.logger, 'getByUserId', { found: true });
    return row.settings as unknown as UserSettingsData;
  }

  /**
   * Creates or replaces the entire settings JSON for a user
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

    log.methodExit(this.logger, 'upsert', { userId });
    return result.settings as unknown as UserSettingsData;
  }

  // ============================================================================
  // FAVORITE POOL HASH OPERATIONS
  // ============================================================================

  /**
   * Prepends a pool hash to the user's favorites (idempotent)
   *
   * If the hash already exists, it is moved to the front.
   */
  async addFavoritePoolHash(
    userId: string,
    poolHash: string
  ): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'addFavoritePoolHash', { userId, poolHash });

    const current = await this.getByUserId(userId);

    // Remove if already present (will re-prepend)
    const filtered = current.favoritePoolHashes.filter((h) => h !== poolHash);
    const updated: UserSettingsData = {
      ...current,
      favoritePoolHashes: [poolHash, ...filtered],
    };

    const result = await this.upsert(userId, updated);
    log.methodExit(this.logger, 'addFavoritePoolHash', {
      totalFavorites: result.favoritePoolHashes.length,
    });
    return result;
  }

  /**
   * Removes a pool hash from the user's favorites (idempotent)
   */
  async removeFavoritePoolHash(
    userId: string,
    poolHash: string
  ): Promise<UserSettingsData> {
    log.methodEntry(this.logger, 'removeFavoritePoolHash', {
      userId,
      poolHash,
    });

    const current = await this.getByUserId(userId);
    const updated: UserSettingsData = {
      ...current,
      favoritePoolHashes: current.favoritePoolHashes.filter(
        (h) => h !== poolHash
      ),
    };

    const result = await this.upsert(userId, updated);
    log.methodExit(this.logger, 'removeFavoritePoolHash', {
      totalFavorites: result.favoritePoolHashes.length,
    });
    return result;
  }

  /**
   * Returns the user's favorite pool hashes
   */
  async getFavoritePoolHashes(userId: string): Promise<string[]> {
    const settings = await this.getByUserId(userId);
    return settings.favoritePoolHashes;
  }

  /**
   * Checks if a pool hash is in the user's favorites
   */
  async isFavoritePoolHash(
    userId: string,
    poolHash: string
  ): Promise<boolean> {
    const hashes = await this.getFavoritePoolHashes(userId);
    return hashes.includes(poolHash);
  }
}
