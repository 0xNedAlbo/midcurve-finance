/**
 * Position List Service
 *
 * Lightweight service for listing positions across all protocols.
 * Returns flat position rows with common fields only (no pool/token joins).
 *
 * Use this for:
 * - List views showing multiple positions (sorting, filtering, pagination)
 * - Cross-protocol position queries
 * - Protocol dispatch (positionHash → protocol-specific cards)
 *
 * For fully-typed positions with protocol-specific data, use protocol-specific
 * services (e.g., UniswapV3PositionService) via detail endpoints.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type {
  PositionListFilters,
  PositionListRow,
  PositionListResult,
} from '../types/position-list/position-list-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Prisma select clause for common position fields.
 * No joins — just position table columns needed for list sorting/filtering.
 */
const POSITION_LIST_SELECT = {
  id: true,
  positionHash: true,
  protocol: true,
  currentValue: true,
  currentCostBasis: true,
  realizedPnl: true,
  unrealizedPnl: true,
  realizedCashflow: true,
  unrealizedCashflow: true,
  collectedFees: true,
  unClaimedFees: true,
  lastFeesCollectedAt: true,
  totalApr: true,
  priceRangeLower: true,
  priceRangeUpper: true,
  positionOpenedAt: true,
  positionClosedAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
 * Returns flat rows with common fields — no protocol-specific hydration.
 */
export class PositionListService {
  private readonly _prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: PositionListServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('PositionListService');
  }

  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * List positions for a user with filtering, sorting, and pagination.
   *
   * Returns flat position rows with common fields only.
   * No pool/token joins, no protocol-specific hydration.
   *
   * @param userId - User ID who owns the positions
   * @param filters - Optional filtering, sorting, and pagination options
   * @returns Result with position rows, total count, and pagination metadata
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
        // Only include positions with a valid positionHash
        positionHash: { not: null },
      };

      if (status === 'active') {
        where.isActive = true;
      } else if (status === 'closed') {
        where.isActive = false;
      }

      if (protocols && protocols.length > 0) {
        where.protocol = { in: protocols };
      }

      const validatedLimit = Math.min(Math.max(limit, 1), 100);
      const validatedOffset = Math.max(offset, 0);

      log.dbOperation(this.logger, 'findMany', 'Position', {
        where,
        limit: validatedLimit,
        offset: validatedOffset,
        sortBy,
        sortDirection,
      });

      const [results, total] = await Promise.all([
        this.prisma.position.findMany({
          where,
          select: POSITION_LIST_SELECT,
          orderBy: {
            [sortBy]: sortDirection,
          },
          take: validatedLimit,
          skip: validatedOffset,
        }),
        this.prisma.position.count({ where }),
      ]);

      // Cast positionHash from string | null to string (filtered by where clause)
      const positions: PositionListRow[] = results.map((row) => ({
        ...row,
        positionHash: row.positionHash as string,
      }));

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
}
