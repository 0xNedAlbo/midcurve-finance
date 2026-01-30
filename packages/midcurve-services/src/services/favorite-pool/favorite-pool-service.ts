/**
 * FavoritePoolService
 *
 * Manages user's favorite/bookmarked pools for quick access.
 * Handles pool discovery and stores user-pool relationships.
 *
 * Methods:
 * - addFavorite: Discover pool and add to user's favorites
 * - removeFavorite: Remove a pool from user's favorites
 * - listFavorites: List all favorite pools for a user
 * - isFavorite: Check if a pool is in user's favorites
 */

import { PrismaClient } from '@midcurve/database';
import type { UniswapV3Pool } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import type {
  AddFavoritePoolInput,
  RemoveFavoritePoolInput,
  ListFavoritePoolsInput,
  IsFavoritePoolInput,
} from '../types/favorite-pool/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * FavoritePool result returned by service methods
 *
 * Contains the favorite record with the full pool object
 */
export interface FavoritePoolResult {
  /** Favorite record ID */
  id: string;
  /** User ID who favorited the pool */
  userId: string;
  /** Pool ID */
  poolId: string;
  /** When the favorite was created */
  createdAt: Date;
  /** The full pool object */
  pool: UniswapV3Pool;
}

/**
 * Dependencies for FavoritePoolService
 * All dependencies are optional and will use defaults if not provided
 */
export interface FavoritePoolServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * UniswapV3PoolService for pool discovery
   * If not provided, a new UniswapV3PoolService instance will be created
   */
  poolService?: UniswapV3PoolService;
}

// ============================================================================
// SERVICE
// ============================================================================

/**
 * FavoritePoolService
 *
 * Provides methods for managing user's favorite pools.
 */
export class FavoritePoolService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  protected readonly _poolService: UniswapV3PoolService;

  /**
   * Creates a new FavoritePoolService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.poolService - UniswapV3PoolService instance (creates default if not provided)
   */
  constructor(dependencies: FavoritePoolServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('FavoritePoolService');
    this._poolService =
      dependencies.poolService ??
      new UniswapV3PoolService({ prisma: this._prisma });
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get the pool service instance
   */
  protected get poolService(): UniswapV3PoolService {
    return this._poolService;
  }

  // ============================================================================
  // ADD FAVORITE
  // ============================================================================

  /**
   * Add a pool to user's favorites
   *
   * This method:
   * 1. Discovers the pool (triggers token discovery if needed)
   * 2. Creates a favorite record linking the user to the pool
   *
   * If the pool is already favorited by the user, returns the existing favorite.
   *
   * @param input - AddFavoritePoolInput with userId, chainId, poolAddress
   * @returns FavoritePoolResult with the pool and favorite metadata
   * @throws Error if pool discovery fails
   * @throws Error if user doesn't exist
   */
  async addFavorite(input: AddFavoritePoolInput): Promise<FavoritePoolResult> {
    const { userId, chainId, poolAddress } = input;
    log.methodEntry(this.logger, 'addFavorite', { userId, chainId, poolAddress });

    try {
      // 1. Discover the pool (this triggers token discovery as well)
      this.logger.debug(
        { chainId, poolAddress },
        'Discovering pool for favorite'
      );

      const pool = await this.poolService.discover({
        poolAddress,
        chainId,
      });

      this.logger.debug(
        { poolId: pool.id, poolAddress: pool.address },
        'Pool discovered successfully'
      );

      // 2. Check if already favorited
      const existing = await this.prisma.favoritePool.findUnique({
        where: {
          userId_poolId: {
            userId,
            poolId: pool.id,
          },
        },
      });

      if (existing) {
        this.logger.debug(
          { userId, poolId: pool.id },
          'Pool already in favorites, returning existing'
        );

        log.methodExit(this.logger, 'addFavorite', {
          id: existing.id,
          alreadyExists: true,
        });

        return {
          id: existing.id,
          userId: existing.userId,
          poolId: existing.poolId,
          createdAt: existing.createdAt,
          pool,
        };
      }

      // 3. Create favorite record
      log.dbOperation(this.logger, 'create', 'FavoritePool', { userId, poolId: pool.id });

      const favorite = await this.prisma.favoritePool.create({
        data: {
          userId,
          poolId: pool.id,
        },
      });

      this.logger.info(
        {
          id: favorite.id,
          userId,
          poolId: pool.id,
          poolAddress: pool.address,
          chainId: pool.chainId,
        },
        'Pool added to favorites'
      );

      log.methodExit(this.logger, 'addFavorite', { id: favorite.id });

      return {
        id: favorite.id,
        userId: favorite.userId,
        poolId: favorite.poolId,
        createdAt: favorite.createdAt,
        pool,
      };
    } catch (error) {
      log.methodError(this.logger, 'addFavorite', error as Error, {
        userId,
        chainId,
        poolAddress,
      });
      throw error;
    }
  }

  // ============================================================================
  // REMOVE FAVORITE
  // ============================================================================

  /**
   * Remove a pool from user's favorites
   *
   * Silently succeeds if the favorite doesn't exist (idempotent).
   *
   * @param input - RemoveFavoritePoolInput with userId and poolId
   * @returns void
   */
  async removeFavorite(input: RemoveFavoritePoolInput): Promise<void> {
    const { userId, poolId } = input;
    log.methodEntry(this.logger, 'removeFavorite', { userId, poolId });

    try {
      // Delete the favorite (uses unique constraint for efficiency)
      log.dbOperation(this.logger, 'delete', 'FavoritePool', { userId, poolId });

      await this.prisma.favoritePool.deleteMany({
        where: {
          userId,
          poolId,
        },
      });

      this.logger.info(
        { userId, poolId },
        'Pool removed from favorites'
      );

      log.methodExit(this.logger, 'removeFavorite', { userId, poolId });
    } catch (error) {
      log.methodError(this.logger, 'removeFavorite', error as Error, {
        userId,
        poolId,
      });
      throw error;
    }
  }

  // ============================================================================
  // LIST FAVORITES
  // ============================================================================

  /**
   * List all favorite pools for a user
   *
   * Returns pools ordered by when they were favorited (most recent first).
   *
   * @param input - ListFavoritePoolsInput with userId and optional pagination
   * @returns Array of FavoritePoolResult objects
   */
  async listFavorites(input: ListFavoritePoolsInput): Promise<FavoritePoolResult[]> {
    const { userId, limit = 50, offset = 0 } = input;
    log.methodEntry(this.logger, 'listFavorites', { userId, limit, offset });

    try {
      log.dbOperation(this.logger, 'findMany', 'FavoritePool', { userId, limit, offset });

      const favorites = await this.prisma.favoritePool.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });

      // Map to FavoritePoolResult with UniswapV3Pool instances
      const results: FavoritePoolResult[] = [];

      for (const fav of favorites) {
        // Only include uniswapv3 pools (filter out other protocols)
        if (fav.pool.protocol !== 'uniswapv3') {
          this.logger.debug(
            { favoriteId: fav.id, protocol: fav.pool.protocol },
            'Skipping non-uniswapv3 pool in favorites'
          );
          continue;
        }

        // Get the pool as a UniswapV3Pool instance
        const pool = await this.poolService.findById(fav.poolId);
        if (!pool) {
          this.logger.warn(
            { favoriteId: fav.id, poolId: fav.poolId },
            'Favorite pool not found, skipping'
          );
          continue;
        }

        results.push({
          id: fav.id,
          userId: fav.userId,
          poolId: fav.poolId,
          createdAt: fav.createdAt,
          pool,
        });
      }

      this.logger.debug(
        { userId, count: results.length, limit, offset },
        'Favorite pools listed'
      );

      log.methodExit(this.logger, 'listFavorites', { count: results.length });

      return results;
    } catch (error) {
      log.methodError(this.logger, 'listFavorites', error as Error, {
        userId,
        limit,
        offset,
      });
      throw error;
    }
  }

  // ============================================================================
  // IS FAVORITE
  // ============================================================================

  /**
   * Check if a pool is in user's favorites
   *
   * @param input - IsFavoritePoolInput with userId and poolId
   * @returns true if the pool is favorited, false otherwise
   */
  async isFavorite(input: IsFavoritePoolInput): Promise<boolean> {
    const { userId, poolId } = input;
    log.methodEntry(this.logger, 'isFavorite', { userId, poolId });

    try {
      log.dbOperation(this.logger, 'findUnique', 'FavoritePool', { userId, poolId });

      const favorite = await this.prisma.favoritePool.findUnique({
        where: {
          userId_poolId: {
            userId,
            poolId,
          },
        },
        select: { id: true }, // Only need to check existence
      });

      const result = favorite !== null;

      log.methodExit(this.logger, 'isFavorite', { userId, poolId, isFavorite: result });

      return result;
    } catch (error) {
      log.methodError(this.logger, 'isFavorite', error as Error, {
        userId,
        poolId,
      });
      throw error;
    }
  }

  // ============================================================================
  // COUNT FAVORITES
  // ============================================================================

  /**
   * Count the number of favorite pools for a user
   *
   * @param userId - User ID to count favorites for
   * @returns Number of favorite pools
   */
  async countFavorites(userId: string): Promise<number> {
    log.methodEntry(this.logger, 'countFavorites', { userId });

    try {
      log.dbOperation(this.logger, 'count', 'FavoritePool', { userId });

      const count = await this.prisma.favoritePool.count({
        where: { userId },
      });

      log.methodExit(this.logger, 'countFavorites', { userId, count });

      return count;
    } catch (error) {
      log.methodError(this.logger, 'countFavorites', error as Error, { userId });
      throw error;
    }
  }
}
