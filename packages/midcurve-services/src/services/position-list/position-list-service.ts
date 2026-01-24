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
import type { PositionInterface, PositionRow } from '@midcurve/shared';
import type { Erc20TokenRow, UniswapV3PoolRow } from '@midcurve/shared';
import { PositionFactory, PoolFactory, Erc20Token, UniswapV3Pool } from '@midcurve/shared';
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
   * Returns PositionInterface instances using the factory pattern.
   * For fully-typed positions with protocol-specific accessors, use protocol-specific
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

      // Map database results to PositionInterface using factory
      const positions = results.map((result) => this.mapToPosition(result as any));

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
   * Map database result to PositionInterface using factory
   *
   * Creates token and pool instances, then uses PositionFactory
   * to create the protocol-specific position class.
   *
   * @param dbResult - Raw database result from Prisma
   * @returns PositionInterface instance
   */
  private mapToPosition(dbResult: {
    id: string;
    positionHash: string | null;
    createdAt: Date;
    updatedAt: Date;
    protocol: string;
    positionType: string;
    userId: string;
    currentValue: string;
    currentCostBasis: string;
    realizedPnl: string;
    unrealizedPnl: string;
    realizedCashflow: string;
    unrealizedCashflow: string;
    collectedFees: string;
    unClaimedFees: string;
    lastFeesCollectedAt: Date;
    totalApr: number | null;
    priceRangeLower: string;
    priceRangeUpper: string;
    poolId: string;
    isToken0Quote: boolean;
    positionOpenedAt: Date;
    positionClosedAt: Date | null;
    isActive: boolean;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
    pool: {
      id: string;
      protocol: string;
      poolType: string;
      feeBps: number;
      config: Record<string, unknown>;
      state: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
      token0: Erc20TokenRow;
      token1: Erc20TokenRow;
    };
  }): PositionInterface {
    // Create token instances
    const token0 = Erc20Token.fromDB(dbResult.pool.token0);
    const token1 = Erc20Token.fromDB(dbResult.pool.token1);

    // Create pool instance
    const pool = PoolFactory.fromDB(
      dbResult.pool as unknown as UniswapV3PoolRow,
      token0,
      token1
    ) as UniswapV3Pool;

    // Convert string bigint fields to native bigint
    const positionRow: PositionRow = {
      id: dbResult.id,
      positionHash: dbResult.positionHash ?? '',
      userId: dbResult.userId,
      protocol: dbResult.protocol,
      positionType: dbResult.positionType,
      poolId: dbResult.poolId,
      isToken0Quote: dbResult.isToken0Quote,
      currentValue: BigInt(dbResult.currentValue),
      currentCostBasis: BigInt(dbResult.currentCostBasis),
      realizedPnl: BigInt(dbResult.realizedPnl),
      unrealizedPnl: BigInt(dbResult.unrealizedPnl),
      realizedCashflow: BigInt(dbResult.realizedCashflow),
      unrealizedCashflow: BigInt(dbResult.unrealizedCashflow),
      collectedFees: BigInt(dbResult.collectedFees),
      unClaimedFees: BigInt(dbResult.unClaimedFees),
      lastFeesCollectedAt: dbResult.lastFeesCollectedAt,
      totalApr: dbResult.totalApr,
      priceRangeLower: BigInt(dbResult.priceRangeLower),
      priceRangeUpper: BigInt(dbResult.priceRangeUpper),
      positionOpenedAt: dbResult.positionOpenedAt,
      positionClosedAt: dbResult.positionClosedAt,
      isActive: dbResult.isActive,
      config: dbResult.config,
      state: dbResult.state,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      pool: dbResult.pool as unknown as UniswapV3PoolRow & {
        token0: Erc20TokenRow;
        token1: Erc20TokenRow;
      },
    };

    // Use factory to create protocol-specific position class
    return PositionFactory.fromDB(positionRow, pool);
  }
}
