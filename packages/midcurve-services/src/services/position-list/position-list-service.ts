/**
 * Position List Service
 *
 * Lightweight service for listing positions across all protocols.
 * Returns positions with config/state as unknown (no protocol-specific parsing).
 *
 * Use this for:
 * - List views showing multiple positions
 * - Cross-protocol position queries
 * - Performance-sensitive queries (no parsing overhead)
 *
 * For fully-typed positions with parsed config/state, use protocol-specific
 * services (e.g., UniswapV3PositionService).
 */

import { PrismaClient } from '@midcurve/database';
import type { AnyPosition } from '@midcurve/shared';
import type {
  PositionListFilters,
  PositionListResult,
} from '../types/position-list/position-list-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for PositionListService
 * All dependencies are optional and will use defaults if not provided
 */
export interface PositionListServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Position List Service
 *
 * Provides lightweight position listing with filtering, sorting, and pagination.
 */
export class PositionListService {
  private readonly _prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new PositionListService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: PositionListServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('PositionListService');
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * List positions for a user with filtering, sorting, and pagination
   *
   * Returns lightweight AnyPosition objects with config/state as unknown.
   * No protocol-specific parsing is performed - this is optimized for list views.
   *
   * For fully-typed positions with parsed config/state, use protocol-specific
   * services (e.g., UniswapV3PositionService).
   *
   * @param userId - User ID who owns the positions
   * @param filters - Optional filtering, sorting, and pagination options
   * @returns Result with positions array, total count, and pagination metadata
   *
   * @example
   * ```typescript
   * const service = new PositionListService({ prisma });
   *
   * // Get first page of active positions
   * const result = await service.list(userId, {
   *   status: 'active',
   *   limit: 20,
   *   offset: 0,
   * });
   *
   * console.log(`Showing ${result.positions.length} of ${result.total} positions`);
   * ```
   */
  async list(
    userId: string,
    filters?: PositionListFilters
  ): Promise<PositionListResult> {
    const {
      status = 'all',
      protocols,
      limit = 20,
      offset = 0,
      sortBy = 'createdAt',
      sortDirection = 'desc',
    } = filters ?? {};

    log.methodEntry(this.logger, 'list', {
      userId,
      status,
      protocols,
      limit,
      offset,
      sortBy,
      sortDirection,
    });

    try {
      // Build where clause
      const where: any = {
        userId,
      };

      // Add status filter
      if (status === 'active') {
        where.isActive = true;
      } else if (status === 'closed') {
        where.isActive = false;
      }
      // For 'all', don't add isActive filter

      // Add protocol filter
      if (protocols && protocols.length > 0) {
        where.protocol = {
          in: protocols,
        };
      }

      // Validate and clamp pagination parameters
      const validatedLimit = Math.min(Math.max(limit, 1), 100);
      const validatedOffset = Math.max(offset, 0);

      log.dbOperation(this.logger, 'findMany', 'Position', {
        where,
        limit: validatedLimit,
        offset: validatedOffset,
        sortBy,
        sortDirection,
      });

      // Execute queries in parallel
      const [results, total] = await Promise.all([
        this.prisma.position.findMany({
          where,
          include: {
            pool: {
              include: {
                token0: true,
                token1: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortDirection,
          },
          take: validatedLimit,
          skip: validatedOffset,
        }),
        this.prisma.position.count({ where }),
      ]);

      // Map database results to AnyPosition
      const positions = results.map((result) => this.mapToPosition(result));

      this.logger.info(
        {
          userId,
          status,
          protocols,
          count: positions.length,
          total,
          limit: validatedLimit,
          offset: validatedOffset,
        },
        'Positions retrieved'
      );

      log.methodExit(this.logger, 'list', {
        count: positions.length,
        total,
      });

      return {
        positions,
        total,
        limit: validatedLimit,
        offset: validatedOffset,
      };
    } catch (error) {
      log.methodError(this.logger, 'list', error as Error, {
        userId,
        filters,
      });
      throw error;
    }
  }

  /**
   * Map database result to AnyPosition
   *
   * Converts database types to application types:
   * - String bigints → native bigint
   * - Includes full pool object (not poolId)
   * - Config/state remain as unknown (no parsing)
   *
   * @param dbResult - Raw database result from Prisma
   * @returns AnyPosition with unknown config/state
   */
  private mapToPosition(dbResult: any): AnyPosition {
    return {
      // Identity
      id: dbResult.id,
      positionHash: dbResult.positionHash ?? '',
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,

      // Protocol identification
      protocol: dbResult.protocol as any,
      positionType: dbResult.positionType as any,

      // Ownership
      userId: dbResult.userId,

      // Financial fields (string → bigint)
      currentValue: BigInt(dbResult.currentValue),
      currentCostBasis: BigInt(dbResult.currentCostBasis),
      realizedPnl: BigInt(dbResult.realizedPnl),
      unrealizedPnl: BigInt(dbResult.unrealizedPnl),
      collectedFees: BigInt(dbResult.collectedFees),
      unClaimedFees: BigInt(dbResult.unClaimedFees),
      lastFeesCollectedAt: dbResult.lastFeesCollectedAt,

      // Price range (string → bigint)
      priceRangeLower: BigInt(dbResult.priceRangeLower),
      priceRangeUpper: BigInt(dbResult.priceRangeUpper),

      // Pool (full object, not poolId - matches @midcurve/shared)
      pool: this.mapPool(dbResult.pool),
      isToken0Quote: dbResult.isToken0Quote,

      // Status
      positionOpenedAt: dbResult.positionOpenedAt,
      positionClosedAt: dbResult.positionClosedAt,
      isActive: dbResult.isActive,

      // Protocol-specific data (NO parsing - returned as-is)
      config: dbResult.config as any,
      state: dbResult.state as any,
    };
  }

  /**
   * Map database pool to Pool object
   *
   * Returns pool with config/state as unknown (no parsing).
   *
   * @param dbPool - Raw database pool from Prisma
   * @returns Pool with unknown config/state
   */
  private mapPool(dbPool: any): any {
    return {
      id: dbPool.id,
      createdAt: dbPool.createdAt,
      updatedAt: dbPool.updatedAt,
      protocol: dbPool.protocol,
      poolType: dbPool.poolType,
      feeBps: dbPool.feeBps,
      token0: this.mapToken(dbPool.token0),
      token1: this.mapToken(dbPool.token1),
      config: dbPool.config, // No parsing
      state: dbPool.state, // No parsing
    };
  }

  /**
   * Map database token to Token object
   *
   * Returns token with config as unknown (no parsing).
   *
   * @param dbToken - Raw database token from Prisma
   * @returns Token with unknown config
   */
  private mapToken(dbToken: any): any {
    return {
      id: dbToken.id,
      createdAt: dbToken.createdAt,
      updatedAt: dbToken.updatedAt,
      tokenType: dbToken.tokenType,
      name: dbToken.name,
      symbol: dbToken.symbol,
      decimals: dbToken.decimals,
      logoUrl: dbToken.logoUrl ?? undefined,
      coingeckoId: dbToken.coingeckoId ?? undefined,
      marketCap: dbToken.marketCap ?? undefined,
      config: dbToken.config, // No parsing
    };
  }
}
