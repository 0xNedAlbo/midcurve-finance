/**
 * FavoritePoolService
 *
 * Manages user's favorite/bookmarked pools for quick access.
 * Handles pool discovery and stores favorites as pool hashes
 * in the UserSettings JSON structure.
 *
 * Methods:
 * - addFavorite: Discover pool and add to user's favorites
 * - removeFavorite: Remove a pool from user's favorites
 * - removeFavoriteByAddress: Remove a pool from favorites by chain + address
 * - listFavorites: List all favorite pools for a user
 * - isFavorite: Check if a pool is in user's favorites
 * - areFavorites: Batch check multiple pools
 * - countFavorites: Count user's favorites
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { UniswapV3Pool } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/uniswapv3-subgraph-client.js';
import { UserSettingsService } from '../user-settings/user-settings-service.js';
import type {
  AddFavoritePoolInput,
  RemoveFavoritePoolByAddressInput,
  ListFavoritePoolsInput,
} from '../types/favorite-pool/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * FavoritePool result returned by service methods
 *
 * Contains the pool hash identifier with the full pool object
 */
export interface FavoritePoolResult {
  /** Pool hash identifier (e.g. "uniswapv3/42161/0xABC...") */
  poolHash: string;
  /** User ID who favorited the pool */
  userId: string;
  /** Pool database ID */
  poolId: string;
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
  prisma?: PrismaClient;
  poolService?: UniswapV3PoolService;
  subgraphClient?: UniswapV3SubgraphClient;
  userSettingsService?: UserSettingsService;
}

// ============================================================================
// SERVICE
// ============================================================================

/**
 * FavoritePoolService
 *
 * Provides methods for managing user's favorite pools.
 * Stores favorites as pool hashes in UserSettings JSON.
 */
export class FavoritePoolService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  protected readonly _poolService: UniswapV3PoolService;
  protected readonly _subgraphClient: UniswapV3SubgraphClient;
  protected readonly _userSettingsService: UserSettingsService;

  constructor(dependencies: FavoritePoolServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('FavoritePoolService');
    this._poolService =
      dependencies.poolService ??
      new UniswapV3PoolService();
    this._subgraphClient =
      dependencies.subgraphClient ?? UniswapV3SubgraphClient.getInstance();
    this._userSettingsService =
      dependencies.userSettingsService ??
      new UserSettingsService({ prisma: this._prisma });
  }

  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  protected get poolService(): UniswapV3PoolService {
    return this._poolService;
  }

  protected get subgraphClient(): UniswapV3SubgraphClient {
    return this._subgraphClient;
  }

  protected get userSettingsService(): UserSettingsService {
    return this._userSettingsService;
  }

  // ============================================================================
  // ADD FAVORITE
  // ============================================================================

  /**
   * Add a pool to user's favorites
   *
   * This method:
   * 1. Discovers the pool (triggers token discovery if needed)
   * 2. Stores the pool hash in the user's settings
   *
   * If the pool is already favorited, moves it to the front (most recent).
   */
  async addFavorite(input: AddFavoritePoolInput): Promise<FavoritePoolResult> {
    const { userId, chainId, poolAddress } = input;
    log.methodEntry(this.logger, 'addFavorite', { userId, chainId, poolAddress });

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

    // 2. Store pool hash in user settings
    const poolHash = this.poolService.createHash({
      chainId,
      address: poolAddress,
    });

    await this.userSettingsService.addFavoritePoolHash(userId, poolHash);

    this.logger.info(
      { userId, poolHash, poolId: pool.id },
      'Pool added to favorites'
    );

    log.methodExit(this.logger, 'addFavorite', { poolHash });

    return {
      poolHash,
      userId,
      poolId: pool.id,
      pool,
    };
  }

  // ============================================================================
  // REMOVE FAVORITE BY ADDRESS
  // ============================================================================

  /**
   * Remove a pool from user's favorites using chainId and poolAddress
   *
   * Constructs the pool hash directly — no DB lookup needed.
   * Silently succeeds if the pool is not favorited (idempotent).
   */
  async removeFavoriteByAddress(input: RemoveFavoritePoolByAddressInput): Promise<void> {
    const { userId, chainId, poolAddress } = input;
    log.methodEntry(this.logger, 'removeFavoriteByAddress', { userId, chainId, poolAddress });

    const poolHash = this.poolService.createHash({
      chainId,
      address: poolAddress,
    });

    await this.userSettingsService.removeFavoritePoolHash(userId, poolHash);

    this.logger.info(
      { userId, poolHash },
      'Pool removed from favorites by address'
    );

    log.methodExit(this.logger, 'removeFavoriteByAddress', { userId, poolHash });
  }

  // ============================================================================
  // LIST FAVORITES
  // ============================================================================

  /**
   * List all favorite pools for a user with metrics from subgraph
   *
   * Returns pools ordered most-recent-first (order preserved from settings array).
   * Each pool includes metrics (TVL, volume, fees, APR) fetched from the subgraph.
   */
  async listFavorites(input: ListFavoritePoolsInput): Promise<FavoritePoolWithMetrics[]> {
    const { userId, limit = 50, offset = 0 } = input;
    log.methodEntry(this.logger, 'listFavorites', { userId, limit, offset });

    // 1. Get favorite pool hashes from settings
    const allHashes = await this.userSettingsService.getFavoritePoolHashes(userId);

    // 2. Apply pagination
    const paginatedHashes = allHashes.slice(offset, offset + limit);

    if (paginatedHashes.length === 0) {
      log.methodExit(this.logger, 'listFavorites', { count: 0 });
      return [];
    }

    // 3. Resolve pools by parsing hashes and discovering on-chain
    // Hash format: "uniswapv3/{chainId}/{poolAddress}"
    const results: FavoritePoolResult[] = [];

    for (const hash of paginatedHashes) {
      const parts = hash.split('/');
      if (parts.length !== 3 || parts[0] !== 'uniswapv3') {
        this.logger.debug({ poolHash: hash }, 'Invalid pool hash format, skipping');
        continue;
      }

      const chainId = Number(parts[1]);
      const poolAddress = parts[2]!;

      const pool = await this.poolService.discover({ chainId, poolAddress });
      if (!pool) {
        this.logger.debug({ poolHash: hash }, 'Pool discovery returned null, skipping');
        continue;
      }

      results.push({
        poolHash: hash,
        userId,
        poolId: pool.id,
        pool,
      });
    }

    // 5. Enrich with metrics from subgraph
    const poolsByChain = new Map<number, Array<{ address: string; index: number }>>();
    results.forEach((result, index) => {
      const chainId = result.pool.chainId;
      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }
      poolsByChain.get(chainId)!.push({ address: result.pool.address, index });
    });

    const metricsPromises = Array.from(poolsByChain.entries()).map(
      async ([chainId, pools]) => {
        const addresses = pools.map((p) => p.address);
        const metrics = await this.subgraphClient.getPoolsMetricsBatch(chainId, addresses);
        return { chainId, pools, metrics };
      }
    );

    const chainMetrics = await Promise.all(metricsPromises);

    const defaultMetrics: PoolMetricsData = {
      tvlUSD: '0',
      volume24hUSD: '0',
      fees24hUSD: '0',
      fees7dUSD: '0',
      apr7d: 0,
    };

    const enrichedResults: FavoritePoolWithMetrics[] = results.map((result) => ({
      ...result,
      metrics: { ...defaultMetrics },
    }));

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
  }

  // ============================================================================
  // IS FAVORITE
  // ============================================================================

  /**
   * Check if a pool is in user's favorites by chainId and address
   */
  async isFavorite(
    userId: string,
    chainId: number,
    poolAddress: string
  ): Promise<boolean> {
    log.methodEntry(this.logger, 'isFavorite', { userId, chainId, poolAddress });

    const poolHash = this.poolService.createHash({
      chainId,
      address: poolAddress,
    });

    const result = await this.userSettingsService.isFavoritePoolHash(userId, poolHash);

    log.methodExit(this.logger, 'isFavorite', { isFavorite: result });
    return result;
  }

  // ============================================================================
  // ARE FAVORITES (BATCH CHECK)
  // ============================================================================

  /**
   * Check which pools from a list are in user's favorites
   *
   * @returns Set of "chainId:address" keys for pools that are favorited
   */
  async areFavorites(
    userId: string,
    pools: Array<{ chainId: number; poolAddress: string }>
  ): Promise<Set<string>> {
    log.methodEntry(this.logger, 'areFavorites', { userId, poolCount: pools.length });

    if (pools.length === 0) {
      log.methodExit(this.logger, 'areFavorites', { count: 0 });
      return new Set();
    }

    // Get all favorite hashes as a Set for O(1) lookups
    const favoriteHashes = new Set(
      await this.userSettingsService.getFavoritePoolHashes(userId)
    );

    const result = new Set<string>();
    for (const pool of pools) {
      const poolHash = this.poolService.createHash({
        chainId: pool.chainId,
        address: pool.poolAddress,
      });
      if (favoriteHashes.has(poolHash)) {
        result.add(`${pool.chainId}:${pool.poolAddress}`);
      }
    }

    this.logger.debug(
      { userId, poolsChecked: pools.length, favoritesFound: result.size },
      'Batch favorite check completed'
    );

    log.methodExit(this.logger, 'areFavorites', { count: result.size });
    return result;
  }

  // ============================================================================
  // COUNT FAVORITES
  // ============================================================================

  /**
   * Count the number of favorite pools for a user
   */
  async countFavorites(userId: string): Promise<number> {
    log.methodEntry(this.logger, 'countFavorites', { userId });

    const hashes = await this.userSettingsService.getFavoritePoolHashes(userId);
    const count = hashes.length;

    log.methodExit(this.logger, 'countFavorites', { userId, count });
    return count;
  }
}
