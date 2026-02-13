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

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { UniswapV3Pool } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/uniswapv3-subgraph-client.js';
import type {
  AddFavoritePoolInput,
  RemoveFavoritePoolInput,
  RemoveFavoritePoolByAddressInput,
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
 * Pool metrics from subgraph
 */
export interface PoolMetricsData {
  tvlUSD: string;
  volume24hUSD: string;
  fees24hUSD: string;
  fees7dUSD: string;
  apr7d: number;
}

/**
 * FavoritePoolResult with metrics from subgraph
 */
export interface FavoritePoolWithMetrics extends FavoritePoolResult {
  /** Pool metrics from subgraph */
  metrics: PoolMetricsData;
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

  /**
   * UniswapV3SubgraphClient for fetching pool metrics
   * If not provided, the singleton instance will be used
   */
  subgraphClient?: UniswapV3SubgraphClient;
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
  protected readonly _subgraphClient: UniswapV3SubgraphClient;

  /**
   * Creates a new FavoritePoolService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.poolService - UniswapV3PoolService instance (creates default if not provided)
   * @param dependencies.subgraphClient - UniswapV3SubgraphClient instance (uses singleton if not provided)
   */
  constructor(dependencies: FavoritePoolServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('FavoritePoolService');
    this._poolService =
      dependencies.poolService ??
      new UniswapV3PoolService({ prisma: this._prisma });
    this._subgraphClient =
      dependencies.subgraphClient ?? UniswapV3SubgraphClient.getInstance();
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

  /**
   * Get the subgraph client instance
   */
  protected get subgraphClient(): UniswapV3SubgraphClient {
    return this._subgraphClient;
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
  // REMOVE FAVORITE BY ADDRESS
  // ============================================================================

  /**
   * Remove a pool from user's favorites using chainId and poolAddress
   *
   * This method is used by API endpoints that identify pools by chainId + poolAddress
   * instead of database IDs.
   *
   * Silently succeeds if the pool or favorite doesn't exist (idempotent).
   *
   * @param input - RemoveFavoritePoolByAddressInput with userId, chainId, poolAddress
   * @returns void
   */
  async removeFavoriteByAddress(input: RemoveFavoritePoolByAddressInput): Promise<void> {
    const { userId, chainId, poolAddress } = input;
    log.methodEntry(this.logger, 'removeFavoriteByAddress', { userId, chainId, poolAddress });

    try {
      // 1. Find the pool by address and chain
      const pool = await this.poolService.findByAddressAndChain(poolAddress, chainId);

      if (!pool) {
        // Pool doesn't exist, so favorite can't exist either
        this.logger.debug(
          { chainId, poolAddress },
          'Pool not found, nothing to remove from favorites'
        );
        log.methodExit(this.logger, 'removeFavoriteByAddress', { poolNotFound: true });
        return;
      }

      // 2. Delete the favorite using the existing logic
      log.dbOperation(this.logger, 'delete', 'FavoritePool', { userId, poolId: pool.id });

      await this.prisma.favoritePool.deleteMany({
        where: {
          userId,
          poolId: pool.id,
        },
      });

      this.logger.info(
        { userId, poolId: pool.id, chainId, poolAddress },
        'Pool removed from favorites by address'
      );

      log.methodExit(this.logger, 'removeFavoriteByAddress', { userId, poolId: pool.id });
    } catch (error) {
      log.methodError(this.logger, 'removeFavoriteByAddress', error as Error, {
        userId,
        chainId,
        poolAddress,
      });
      throw error;
    }
  }

  // ============================================================================
  // LIST FAVORITES
  // ============================================================================

  /**
   * List all favorite pools for a user with metrics from subgraph
   *
   * Returns pools ordered by when they were favorited (most recent first).
   * Each pool includes metrics (TVL, volume, fees, APR) fetched from the subgraph.
   *
   * @param input - ListFavoritePoolsInput with userId and optional pagination
   * @returns Array of FavoritePoolWithMetrics objects
   */
  async listFavorites(input: ListFavoritePoolsInput): Promise<FavoritePoolWithMetrics[]> {
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

      // Enrich with metrics from subgraph
      // Group by chainId for efficient batch queries
      const poolsByChain = new Map<number, Array<{ address: string; index: number }>>();
      results.forEach((result, index) => {
        const chainId = result.pool.chainId;
        if (!poolsByChain.has(chainId)) {
          poolsByChain.set(chainId, []);
        }
        poolsByChain.get(chainId)!.push({ address: result.pool.address, index });
      });

      // Fetch metrics for each chain in parallel
      const metricsPromises = Array.from(poolsByChain.entries()).map(
        async ([chainId, pools]) => {
          const addresses = pools.map((p) => p.address);
          const metrics = await this.subgraphClient.getPoolsMetricsBatch(chainId, addresses);
          return { chainId, pools, metrics };
        }
      );

      const chainMetrics = await Promise.all(metricsPromises);

      // Default metrics for pools without subgraph data
      const defaultMetrics: PoolMetricsData = {
        tvlUSD: '0',
        volume24hUSD: '0',
        fees24hUSD: '0',
        fees7dUSD: '0',
        apr7d: 0,
      };

      // Build enriched results
      const enrichedResults: FavoritePoolWithMetrics[] = results.map((result) => ({
        ...result,
        metrics: { ...defaultMetrics },
      }));

      // Merge metrics from subgraph
      for (const { pools, metrics } of chainMetrics) {
        for (const { address, index } of pools) {
          const poolMetrics = metrics.get(address.toLowerCase());
          if (poolMetrics) {
            enrichedResults[index]!.metrics = {
              tvlUSD: poolMetrics.tvlUSD,
              volume24hUSD: poolMetrics.volume24hUSD,
              fees24hUSD: poolMetrics.fees24hUSD,
              fees7dUSD: poolMetrics.fees7dUSD,
              apr7d: poolMetrics.apr7d,
            };
          }
        }
      }

      this.logger.debug(
        { userId, count: enrichedResults.length, limit, offset },
        'Favorite pools listed with metrics'
      );

      log.methodExit(this.logger, 'listFavorites', { count: enrichedResults.length });

      return enrichedResults;
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
  // ARE FAVORITES (BATCH CHECK)
  // ============================================================================

  /**
   * Check which pools from a list are in user's favorites
   *
   * Efficient batch lookup for checking multiple pools at once.
   * Useful for enriching search results with favorite status.
   *
   * @param userId - User ID to check favorites for
   * @param pools - Array of pool identifiers with chainId and poolAddress
   * @returns Set of "chainId:address" keys for pools that are favorited
   *
   * @example
   * ```typescript
   * const favorites = await service.areFavorites('user123', [
   *   { chainId: 1, poolAddress: '0x123...' },
   *   { chainId: 42161, poolAddress: '0x456...' },
   * ]);
   * // Returns Set { "1:0x123...", "42161:0x456..." } if both are favorited
   * ```
   */
  async areFavorites(
    userId: string,
    pools: Array<{ chainId: number; poolAddress: string }>
  ): Promise<Set<string>> {
    log.methodEntry(this.logger, 'areFavorites', { userId, poolCount: pools.length });

    // Early return for empty array
    if (pools.length === 0) {
      log.methodExit(this.logger, 'areFavorites', { count: 0 });
      return new Set();
    }

    try {
      // Build poolHash values for efficient lookup using pool service's createHash
      const poolHashToInput = new Map<string, { chainId: number; poolAddress: string }>();
      const poolHashes: string[] = [];

      for (const pool of pools) {
        const poolHash = this.poolService.createHash({
          chainId: pool.chainId,
          address: pool.poolAddress,
        });
        poolHashes.push(poolHash);
        poolHashToInput.set(poolHash, pool);
      }

      // Query all matching pools from database using poolHash
      log.dbOperation(this.logger, 'findMany', 'Pool', { poolCount: pools.length });

      const matchingPools = await this.prisma.pool.findMany({
        where: {
          poolHash: { in: poolHashes },
        },
        select: {
          id: true,
          poolHash: true,
        },
      });

      if (matchingPools.length === 0) {
        this.logger.debug({ userId }, 'No matching pools found in database');
        log.methodExit(this.logger, 'areFavorites', { count: 0 });
        return new Set();
      }

      // Get pool IDs
      const poolIds = matchingPools.map((p) => p.id);

      // Query favorites for these pools
      log.dbOperation(this.logger, 'findMany', 'FavoritePool', { userId, poolIds: poolIds.length });

      const favorites = await this.prisma.favoritePool.findMany({
        where: {
          userId,
          poolId: { in: poolIds },
        },
        select: {
          poolId: true,
        },
      });

      // Build set of favorited pool IDs
      const favoritedPoolIds = new Set(favorites.map((f) => f.poolId));

      // Map back to "chainId:address" keys
      const result = new Set<string>();
      for (const pool of matchingPools) {
        if (favoritedPoolIds.has(pool.id) && pool.poolHash) {
          // Get original input from poolHash lookup (both use normalized addresses)
          const original = poolHashToInput.get(pool.poolHash);
          if (original) {
            result.add(`${original.chainId}:${original.poolAddress}`);
          }
        }
      }

      this.logger.debug(
        { userId, poolsChecked: pools.length, favoritesFound: result.size },
        'Batch favorite check completed'
      );

      log.methodExit(this.logger, 'areFavorites', { count: result.size });

      return result;
    } catch (error) {
      log.methodError(this.logger, 'areFavorites', error as Error, {
        userId,
        poolCount: pools.length,
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
