/**
 * Abstract Pool Service
 *
 * Base class for protocol-specific pool services.
 * Provides shared infrastructure (Prisma client, logging) and common patterns.
 *
 * Subclasses (UniswapV3PoolService) implement:
 * - Type-specific CRUD operations returning concrete class instances
 * - Discovery methods
 * - Config/state serialization using the class-based pattern from @midcurve/shared
 *
 * Design: Services return class instances (UniswapV3Pool)
 * for type-safe config access via .typedConfig and convenience accessors.
 */

import { PrismaClient } from '@midcurve/database';
import type {
  PoolInterface,
  Protocol,
  PoolRow,
  Erc20Token,
} from '@midcurve/shared';
import { PoolFactory } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for PoolService
 * All dependencies are optional and will use defaults if not provided
 */
export interface PoolServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Generic pool result from database (before conversion to class instance)
 * Matches Prisma Pool model output with included token relations
 */
export interface PoolDbResult {
  id: string;
  protocol: string;
  poolType: string;
  token0Id: string;
  token1Id: string;
  feeBps: number;
  config: unknown;
  state: unknown;
  createdAt: Date;
  updatedAt: Date;
  token0?: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
  token1?: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Abstract PoolService
 *
 * Provides base functionality for pool management.
 * Protocol-specific services extend this class and implement
 * their own CRUD, discovery, and search methods.
 *
 * Key difference from TokenService:
 * - Pool contains full Token objects in TypeScript
 * - Database stores only token IDs (token0Id, token1Id)
 * - Derived classes must fetch and populate full Token objects
 */
export abstract class PoolService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  /**
   * Protocol discriminator for this service
   * Must be implemented by subclasses
   */
  protected abstract readonly protocol: Protocol;

  /**
   * Creates a new PoolService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: PoolServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger(this.constructor.name);
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // POLYMORPHIC HELPERS
  // ============================================================================

  /**
   * Convert database result to PoolInterface using the factory pattern.
   *
   * This method uses PoolFactory.fromDB() which routes to the correct
   * concrete class (UniswapV3Pool) based on protocol.
   *
   * Subclasses should override findById/create/update to return their
   * specific type using their own factory method (e.g., UniswapV3Pool.fromDB).
   *
   * @param dbResult - Raw database result from Prisma (with included tokens)
   * @param token0 - Pre-fetched Erc20Token for token0
   * @param token1 - Pre-fetched Erc20Token for token1
   * @returns Pool class instance implementing PoolInterface
   */
  protected mapToPool(
    dbResult: PoolDbResult,
    token0: Erc20Token,
    token1: Erc20Token
  ): PoolInterface {
    return PoolFactory.fromDB(
      {
        id: dbResult.id,
        protocol: dbResult.protocol,
        poolType: dbResult.poolType,
        token0Id: dbResult.token0Id,
        token1Id: dbResult.token1Id,
        feeBps: dbResult.feeBps,
        config: dbResult.config as Record<string, unknown>,
        state: dbResult.state as Record<string, unknown>,
        createdAt: dbResult.createdAt,
        updatedAt: dbResult.updatedAt,
      } as PoolRow,
      token0,
      token1
    );
  }

  // ============================================================================
  // BASE CRUD OPERATIONS
  // ============================================================================

  /**
   * Find a pool by its database ID (polymorphic)
   *
   * Returns a PoolInterface that can be narrowed based on protocol.
   * Subclasses override this to return their specific type with proper
   * token population.
   *
   * Note: Base implementation relies on included token relations.
   * If tokens are not included, this will fail. Subclasses should
   * handle token fetching appropriately.
   *
   * @param id - Pool database ID
   * @returns The pool if found, null otherwise
   */
  async findById(id: string): Promise<PoolInterface | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const result = await this.prisma.pool.findUnique({
        where: { id },
        include: {
          token0: true,
          token1: true,
        },
      });

      if (!result) {
        this.logger.debug({ id }, 'Pool not found');
        log.methodExit(this.logger, 'findById', { found: false });
        return null;
      }

      // Note: This base implementation assumes token relations are included
      // Subclasses should handle token conversion properly
      this.logger.debug(
        { id, protocol: result.protocol, poolType: result.poolType },
        'Pool found'
      );
      log.methodExit(this.logger, 'findById', { id });

      // Subclasses must override to handle token conversion and mapping
      throw new Error(
        'Base PoolService.findById should be overridden by subclasses'
      );
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete a pool
   *
   * Base implementation that handles database operations.
   * Subclasses should override this method to add protocol-specific
   * safeguards and validation (e.g., checking for dependent positions).
   *
   * This operation is idempotent - deleting a non-existent pool
   * returns silently without error.
   *
   * @param id - Pool database ID
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      // Verify pool exists
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const existing = await this.prisma.pool.findUnique({
        where: { id },
      });

      if (!existing) {
        this.logger.debug({ id }, 'Pool not found, nothing to delete');
        log.methodExit(this.logger, 'delete', { id, found: false });
        return; // Idempotent: silently return if pool doesn't exist
      }

      // Delete pool
      log.dbOperation(this.logger, 'delete', 'Pool', { id });

      await this.prisma.pool.delete({
        where: { id },
      });

      this.logger.info(
        {
          id,
          protocol: existing.protocol,
          poolType: existing.poolType,
        },
        'Pool deleted successfully'
      );

      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }
}
