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
import { createErc20TokenHash, normalizeAddress } from '@midcurve/shared';
import type {
  PositionListFilters,
  PositionListPoolSummary,
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
  costBasis: true,
  realizedPnl: true,
  unrealizedPnl: true,
  realizedCashflow: true,
  unrealizedCashflow: true,
  collectedYield: true,
  unclaimedYield: true,
  lastYieldClaimedAt: true,
  type: true,
  totalApr: true,
  baseApr: true,
  rewardApr: true,
  config: true,
  positionOpenedAt: true,
  archivedAt: true,
  isArchived: true,
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
      includePool = false,
    } = filters ?? {};

    log.methodEntry(this.logger, 'list', {
      userId,
      status,
      protocols,
      limit,
      offset,
      sortBy,
      sortDirection,
      includePool,
    });

    try {
      // Build where clause
      const where: any = {
        userId,
        // Only include positions with a valid positionHash
        positionHash: { not: null },
      };

      if (status === 'active') {
        where.isArchived = false;
      } else if (status === 'archived') {
        where.isArchived = true;
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

      // Map DB results to PositionListRow, extracting priceRange from config JSON
      const positions: PositionListRow[] = results.map((row) => {
        const config = row.config as Record<string, unknown>;
        const { config: _config, ...rest } = row;
        return {
          ...rest,
          positionHash: row.positionHash as string,
          priceRangeLower: (config.priceRangeLower as string) ?? '0',
          priceRangeUpper: (config.priceRangeUpper as string) ?? '0',
        };
      });

      if (includePool && positions.length > 0) {
        const configsByPositionId = new Map(
          results.map((row) => [row.id, row.config as Record<string, unknown>])
        );
        await this.attachPoolSummaries(positions, configsByPositionId);
      }

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
   * Mutate `positions` in place by attaching a `pool` summary derived from
   * each position's config JSON plus a single batched Token lookup.
   *
   * Both `uniswapv3` and `uniswapv3-vault` configs carry the same primitives
   * (chainId, poolAddress, token0Address, token1Address, feeBps, isToken0Quote),
   * so a single normalizer works for both.
   */
  private async attachPoolSummaries(
    positions: PositionListRow[],
    configsByPositionId: Map<string, Record<string, unknown>>
  ): Promise<void> {
    type ConfigPoolFields = {
      chainId: number;
      poolAddress: string;
      token0Address: string;
      token1Address: string;
      feeBps: number;
      isToken0Quote: boolean;
    };

    const extracted = new Map<string, ConfigPoolFields>();
    const tokenHashes = new Set<string>();

    for (const position of positions) {
      const config = configsByPositionId.get(position.id);
      if (!config) {
        throw new Error(
          `Position ${position.id} (${position.positionHash}) is missing config — cannot build pool summary`
        );
      }

      const fields: ConfigPoolFields = {
        chainId: config.chainId as number,
        poolAddress: normalizeAddress(config.poolAddress as string),
        token0Address: normalizeAddress(config.token0Address as string),
        token1Address: normalizeAddress(config.token1Address as string),
        feeBps: config.feeBps as number,
        isToken0Quote: config.isToken0Quote as boolean,
      };

      extracted.set(position.id, fields);
      tokenHashes.add(createErc20TokenHash(fields.chainId, fields.token0Address));
      tokenHashes.add(createErc20TokenHash(fields.chainId, fields.token1Address));
    }

    const tokenRows = await this.prisma.token.findMany({
      where: { tokenHash: { in: [...tokenHashes] } },
      select: { tokenHash: true, symbol: true, decimals: true, config: true },
    });

    const tokensByHash = new Map(
      tokenRows.map((t) => [t.tokenHash, t] as const)
    );

    for (const position of positions) {
      const fields = extracted.get(position.id)!;
      const t0Hash = createErc20TokenHash(fields.chainId, fields.token0Address);
      const t1Hash = createErc20TokenHash(fields.chainId, fields.token1Address);
      const t0 = tokensByHash.get(t0Hash);
      const t1 = tokensByHash.get(t1Hash);

      if (!t0) {
        throw new Error(
          `Token not found for ${t0Hash} (position ${position.positionHash})`
        );
      }
      if (!t1) {
        throw new Error(
          `Token not found for ${t1Hash} (position ${position.positionHash})`
        );
      }

      const pool: PositionListPoolSummary = {
        chainId: fields.chainId,
        poolAddress: fields.poolAddress,
        feeBps: fields.feeBps,
        isToken0Quote: fields.isToken0Quote,
        token0: {
          address: fields.token0Address,
          symbol: t0.symbol,
          decimals: t0.decimals,
        },
        token1: {
          address: fields.token1Address,
          symbol: t1.symbol,
          decimals: t1.decimals,
        },
      };

      position.pool = pool;
    }
  }
}
