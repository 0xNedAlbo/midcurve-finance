/**
 * CacheService
 *
 * Provides distributed caching using PostgreSQL as the backend.
 * Designed to share cache across multiple processes, workers, and serverless functions.
 *
 * Features:
 * - TTL-based expiration
 * - Automatic cleanup of expired entries
 * - Type-safe value storage and retrieval
 * - Graceful error handling with fallback behavior
 * - Singleton pattern with dependency injection for testing
 *
 * Use Cases:
 * - CoinGecko API response caching
 * - External API response caching
 * - Expensive computation results
 * - Rate limit coordination across workers
 */

import { PrismaClient } from '@prisma/client';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface CacheServiceDependencies {
  /**
   * Prisma client instance
   * If not provided, a new PrismaClient will be created
   */
  prisma?: PrismaClient;
}

/**
 * CacheService
 *
 * Distributed cache implementation using PostgreSQL.
 * Shared across all application instances, workers, and serverless functions.
 */
export class CacheService {
  private static instance: CacheService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new CacheService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: CacheServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('CacheService');
  }

  /**
   * Get singleton instance of CacheService
   */
  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    CacheService.instance = null;
  }

  /**
   * Get a value from the cache
   *
   * @param key - Cache key
   * @returns Cached value if found and not expired, null otherwise
   *
   * @example
   * ```typescript
   * const tokens = await cache.get<CoinGeckoToken[]>('coingecko:tokens:all');
   * if (tokens) {
   *   // Use cached tokens
   * }
   * ```
   */
  async get<T>(key: string): Promise<T | null> {
    log.methodEntry(this.logger, 'get', { key });

    try {
      const cached = await this.prisma.cache.findUnique({
        where: { key },
      });

      if (!cached) {
        log.cacheMiss(this.logger, 'get', key);
        log.methodExit(this.logger, 'get', { found: false });
        return null;
      }

      const now = new Date();
      if (now > cached.expiresAt) {
        // Expired - delete asynchronously and return null
        this.logger.debug({ key, expiresAt: cached.expiresAt }, 'Cache entry expired');
        log.cacheMiss(this.logger, 'get', key);

        // Delete expired entry (fire and forget)
        this.prisma.cache
          .delete({ where: { key } })
          .catch((error) => {
            this.logger.warn({ key, error }, 'Failed to delete expired cache entry');
          });

        log.methodExit(this.logger, 'get', { found: false, expired: true });
        return null;
      }

      // Valid cached value
      log.cacheHit(this.logger, 'get', key);
      log.methodExit(this.logger, 'get', { found: true });
      return cached.value as T;
    } catch (error) {
      // Log error but don't throw - cache failures should not break the application
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache get failed, returning null'
      );
      log.methodExit(this.logger, 'get', { found: false, error: true });
      return null;
    }
  }

  /**
   * Set a value in the cache
   *
   * @param key - Cache key
   * @param value - Value to cache (must be JSON-serializable)
   * @param ttlSeconds - Time to live in seconds
   * @returns true if successful, false otherwise
   *
   * @example
   * ```typescript
   * await cache.set('coingecko:tokens:all', tokens, 3600); // Cache for 1 hour
   * ```
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    log.methodEntry(this.logger, 'set', { key, ttlSeconds });

    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      await this.prisma.cache.upsert({
        where: { key },
        create: {
          key,
          value: value as any, // Prisma handles JSON serialization
          expiresAt,
        },
        update: {
          value: value as any,
          expiresAt,
          updatedAt: now,
        },
      });

      this.logger.debug({ key, expiresAt }, 'Cache entry set');
      log.methodExit(this.logger, 'set', { success: true });
      return true;
    } catch (error) {
      // Log error but don't throw - cache failures should not break the application
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache set failed'
      );
      log.methodExit(this.logger, 'set', { success: false, error: true });
      return false;
    }
  }

  /**
   * Delete a value from the cache
   *
   * @param key - Cache key to delete
   * @returns true if successful, false otherwise
   *
   * @example
   * ```typescript
   * await cache.delete('coingecko:tokens:all');
   * ```
   */
  async delete(key: string): Promise<boolean> {
    log.methodEntry(this.logger, 'delete', { key });

    try {
      await this.prisma.cache.delete({
        where: { key },
      });

      this.logger.debug({ key }, 'Cache entry deleted');
      log.methodExit(this.logger, 'delete', { success: true });
      return true;
    } catch (error) {
      // P2025: Record not found - this is okay, entry didn't exist
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        this.logger.debug({ key }, 'Cache entry not found (already deleted or never existed)');
        log.methodExit(this.logger, 'delete', { success: true, notFound: true });
        return true;
      }

      // Other errors
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache delete failed'
      );
      log.methodExit(this.logger, 'delete', { success: false, error: true });
      return false;
    }
  }

  /**
   * Clear all cache entries matching a pattern
   *
   * @param pattern - Optional pattern to match keys (SQL LIKE pattern, e.g., 'coingecko:%')
   * @returns Number of entries deleted, or -1 on error
   *
   * @example
   * ```typescript
   * // Clear all CoinGecko cache
   * await cache.clear('coingecko:%');
   *
   * // Clear all cache
   * await cache.clear();
   * ```
   */
  async clear(pattern?: string): Promise<number> {
    log.methodEntry(this.logger, 'clear', { pattern });

    try {
      const where = pattern
        ? {
            key: {
              startsWith: pattern.replace('%', ''),
            },
          }
        : {};

      const result = await this.prisma.cache.deleteMany({ where });

      this.logger.info({ pattern, count: result.count }, 'Cache entries cleared');
      log.methodExit(this.logger, 'clear', { count: result.count });
      return result.count;
    } catch (error) {
      this.logger.warn(
        { pattern, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache clear failed'
      );
      log.methodExit(this.logger, 'clear', { count: -1, error: true });
      return -1;
    }
  }

  /**
   * Clean up expired cache entries
   *
   * This method should be called periodically (e.g., via cron job) to remove
   * expired entries and reclaim database space.
   *
   * @returns Number of entries deleted, or -1 on error
   *
   * @example
   * ```typescript
   * // In a cron job or scheduled task
   * const deleted = await cache.cleanup();
   * console.log(`Cleaned up ${deleted} expired cache entries`);
   * ```
   */
  async cleanup(): Promise<number> {
    log.methodEntry(this.logger, 'cleanup');

    try {
      const now = new Date();
      const result = await this.prisma.cache.deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      });

      this.logger.info({ count: result.count }, 'Expired cache entries cleaned up');
      log.methodExit(this.logger, 'cleanup', { count: result.count });
      return result.count;
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache cleanup failed'
      );
      log.methodExit(this.logger, 'cleanup', { count: -1, error: true });
      return -1;
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Object with total entries, expired entries, and total size
   */
  async getStats(): Promise<{
    totalEntries: number;
    expiredEntries: number;
    activeEntries: number;
  }> {
    log.methodEntry(this.logger, 'getStats');

    try {
      const now = new Date();

      const [totalEntries, expiredEntries] = await Promise.all([
        this.prisma.cache.count(),
        this.prisma.cache.count({
          where: {
            expiresAt: {
              lt: now,
            },
          },
        }),
      ]);

      const activeEntries = totalEntries - expiredEntries;

      log.methodExit(this.logger, 'getStats', {
        totalEntries,
        expiredEntries,
        activeEntries,
      });

      return {
        totalEntries,
        expiredEntries,
        activeEntries,
      };
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to get cache stats'
      );
      return {
        totalEntries: 0,
        expiredEntries: 0,
        activeEntries: 0,
      };
    }
  }
}
