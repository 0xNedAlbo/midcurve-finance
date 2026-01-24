/**
 * Abstract Pool Price Service
 *
 * Base class for protocol-specific pool price services.
 *
 * Pool prices are historic snapshots used for PnL calculations and
 * historical analysis. They are typically write-once records.
 *
 * Protocol implementations (e.g., UniswapV3PoolPriceService) must implement
 * the abstract discover() method and can override CRUD methods for
 * type-specific behavior.
 */

import { PrismaClient } from '@midcurve/database';
import type {
  PoolPriceInterface,
  PoolPriceProtocol,
  PoolPriceRow,
} from '@midcurve/shared';
import { PoolPriceFactory } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { EvmConfig } from '../../config/evm.js';

/**
 * Dependencies for PoolPriceService
 * All dependencies are optional and will use defaults if not provided
 */
export interface PoolPriceServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * EVM configuration for RPC clients
   * If not provided, a new EvmConfig instance will be created
   * Required for discover() method to fetch on-chain data
   */
  evmConfig?: EvmConfig;
}

/**
 * Database result interface for pool price queries.
 * Note: Prisma stores bigint as string in the database, so we use string here.
 * The factory methods handle conversion to native bigint.
 */
export interface PoolPriceDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  protocol: string;
  poolId: string;
  timestamp: Date;
  token1PricePerToken0: string; // Prisma returns bigint as string
  token0PricePerToken1: string; // Prisma returns bigint as string
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Abstract PoolPriceService
 *
 * Provides base functionality for pool price management.
 * Protocol-specific services must extend this class and implement
 * the abstract discover() method.
 */
export abstract class PoolPriceService {
  protected readonly _prisma: PrismaClient;
  protected readonly _evmConfig: EvmConfig;
  protected readonly logger: ServiceLogger;

  /**
   * Protocol identifier for this service
   * Concrete classes must define this (e.g., 'uniswapv3')
   */
  protected abstract readonly protocol: PoolPriceProtocol;

  /**
   * Creates a new PoolPriceService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.evmConfig - EVM config instance (creates default if not provided)
   */
  constructor(dependencies: PoolPriceServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.logger = createServiceLogger(this.constructor.name);
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get the EVM config instance
   */
  protected get evmConfig(): EvmConfig {
    return this._evmConfig;
  }

  // ============================================================================
  // ABSTRACT DISCOVERY METHOD
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Discover and create a historic pool price snapshot from on-chain data
   *
   * Checks the database first for an existing price at the given block.
   * If not found, fetches the pool state from on-chain at the specified block,
   * calculates prices, and stores in database.
   *
   * @param poolId - Pool ID (common parameter for all protocols)
   * @param params - Discovery parameters (protocol-specific)
   * @returns The discovered or existing pool price snapshot
   * @throws Error if discovery fails (protocol-specific errors)
   */
  abstract discover(
    poolId: string,
    params: unknown
  ): Promise<PoolPriceInterface>;

  // ============================================================================
  // CRUD OPERATIONS
  // Base implementations for pool price management
  // Protocol implementations SHOULD override to add type filtering and validation
  // ============================================================================

  /**
   * Find pool price by ID
   *
   * Base implementation returns pool price data.
   * Protocol-specific implementations should override to filter by protocol type.
   *
   * @param id - Pool price ID
   * @returns Pool price if found, null otherwise
   */
  async findById(id: string): Promise<PoolPriceInterface | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'PoolPrice', { id });

      const result = await this.prisma.poolPrice.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      const poolPrice = this.mapToPoolPrice(result as PoolPriceDbResult);

      log.methodExit(this.logger, 'findById', { id, found: true });
      return poolPrice;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find all pool prices for a specific pool
   *
   * Returns all historic price snapshots for a pool, ordered by timestamp descending.
   *
   * @param poolId - Pool ID
   * @returns Array of pool prices, ordered by timestamp (newest first)
   */
  async findByPoolId(poolId: string): Promise<PoolPriceInterface[]> {
    log.methodEntry(this.logger, 'findByPoolId', { poolId });

    try {
      log.dbOperation(this.logger, 'findMany', 'PoolPrice', { poolId });

      const results = await this.prisma.poolPrice.findMany({
        where: { poolId },
        orderBy: { timestamp: 'desc' },
      });

      const poolPrices = results.map((result) =>
        this.mapToPoolPrice(result as PoolPriceDbResult)
      );

      log.methodExit(this.logger, 'findByPoolId', {
        poolId,
        count: poolPrices.length,
      });
      return poolPrices;
    } catch (error) {
      log.methodError(this.logger, 'findByPoolId', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Find pool prices for a specific pool within a time range
   *
   * Returns historic price snapshots for a pool within the specified time range,
   * ordered by timestamp ascending (oldest first).
   *
   * This is the primary query method for PnL calculations that need historic prices.
   *
   * @param poolId - Pool ID
   * @param startTime - Start of time range (inclusive)
   * @param endTime - End of time range (inclusive)
   * @returns Array of pool prices within time range, ordered by timestamp (oldest first)
   */
  async findByPoolIdAndTimeRange(
    poolId: string,
    startTime: Date,
    endTime: Date
  ): Promise<PoolPriceInterface[]> {
    log.methodEntry(this.logger, 'findByPoolIdAndTimeRange', {
      poolId,
      startTime,
      endTime,
    });

    try {
      log.dbOperation(this.logger, 'findMany', 'PoolPrice', {
        poolId,
        timeRange: true,
      });

      const results = await this.prisma.poolPrice.findMany({
        where: {
          poolId,
          timestamp: {
            gte: startTime,
            lte: endTime,
          },
        },
        orderBy: { timestamp: 'asc' }, // Oldest first for time-series analysis
      });

      const poolPrices = results.map((result) =>
        this.mapToPoolPrice(result as PoolPriceDbResult)
      );

      log.methodExit(this.logger, 'findByPoolIdAndTimeRange', {
        poolId,
        count: poolPrices.length,
      });
      return poolPrices;
    } catch (error) {
      log.methodError(this.logger, 'findByPoolIdAndTimeRange', error as Error, {
        poolId,
      });
      throw error;
    }
  }

  /**
   * Delete pool price
   *
   * Base implementation silently succeeds if pool price doesn't exist.
   * Protocol-specific implementations should override to verify protocol type.
   *
   * @param id - Pool price ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      log.dbOperation(this.logger, 'delete', 'PoolPrice', { id });

      await this.prisma.poolPrice.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id, deleted: true });
    } catch (error: any) {
      // P2025 = Record not found
      if (error.code === 'P2025') {
        this.logger.debug({ id }, 'Pool price not found, delete operation is no-op');
        log.methodExit(this.logger, 'delete', { id, deleted: false });
        return;
      }

      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // PROTECTED HELPERS
  // ============================================================================

  /**
   * Map database result to PoolPriceInterface using factory
   *
   * Uses PoolPriceFactory to create protocol-specific instances.
   * Converts string price fields to bigint for factory compatibility.
   * Concrete services should override for type-specific returns.
   *
   * @param dbResult - Raw database result
   * @returns PoolPriceInterface instance
   */
  protected mapToPoolPrice(dbResult: PoolPriceDbResult): PoolPriceInterface {
    // Convert string price fields to bigint for PoolPriceRow compatibility
    const rowWithBigInt: PoolPriceRow = {
      ...dbResult,
      token1PricePerToken0: BigInt(dbResult.token1PricePerToken0),
      token0PricePerToken1: BigInt(dbResult.token0PricePerToken1),
    };
    return PoolPriceFactory.fromDB(rowWithBigInt);
  }
}
