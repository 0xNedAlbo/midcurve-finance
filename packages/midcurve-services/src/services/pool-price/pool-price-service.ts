/**
 * Abstract Pool Price Service
 *
 * Base class for protocol-specific pool price services.
 * Handles serialization/deserialization of config and state between
 * database JSON format and application types.
 *
 * Pool prices are historic snapshots used for PnL calculations and
 * historical analysis. They are typically write-once records.
 *
 * Protocol implementations (e.g., UniswapV3PoolPriceService) must implement
 * all abstract serialization methods.
 */

import { PrismaClient } from '@midcurve/database';
import type { PoolPrice, PoolPriceConfigMap } from '@midcurve/shared';
import type {
  CreatePoolPriceInput,
  UpdatePoolPriceInput,
  PoolPriceDiscoverInput,
} from '../types/pool-price/pool-price-input.js';
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
 * Generic pool price result from database (before deserialization)
 */
interface PoolPriceDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  protocol: string;
  poolId: string;
  timestamp: Date;
  token1PricePerToken0: string; // bigint as string
  token0PricePerToken1: string; // bigint as string
  config: unknown;
  state: unknown;
}

/**
 * Abstract PoolPriceService
 *
 * Provides base functionality for pool price management.
 * Protocol-specific services must extend this class and implement
 * serialization methods for config and state.
 *
 * @template P - Protocol key from PoolPriceConfigMap ('uniswapv3', etc.)
 */
export abstract class PoolPriceService<P extends keyof PoolPriceConfigMap> {
  protected readonly _prisma: PrismaClient;
  protected readonly _evmConfig: EvmConfig;
  protected readonly logger: ServiceLogger;

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
  // ABSTRACT SERIALIZATION METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   *
   * Converts serialized values (if any) to native types.
   * For configs with only primitives, this may be a pass-through.
   *
   * @param configDB - Config object from database (JSON)
   * @returns Parsed config with native types
   */
  abstract parseConfig(configDB: unknown): PoolPriceConfigMap[P]['config'];

  /**
   * Serialize config from application type to database JSON
   *
   * Converts native values (if any) to serializable types.
   * For configs with only primitives, this may be a pass-through.
   *
   * @param config - Application config with native types
   * @returns Serialized config for database storage
   */
  abstract serializeConfig(config: PoolPriceConfigMap[P]['config']): unknown;

  /**
   * Parse state from database JSON to application type
   *
   * Converts serialized values (e.g., bigint strings) to native types.
   *
   * @param stateDB - State object from database (JSON with string values)
   * @returns Parsed state with native types (bigint, etc.)
   */
  abstract parseState(stateDB: unknown): PoolPriceConfigMap[P]['state'];

  /**
   * Serialize state from application type to database JSON
   *
   * Converts native values (e.g., bigint) to serializable types (strings).
   *
   * @param state - Application state with native types
   * @returns Serialized state for database storage
   */
  abstract serializeState(state: PoolPriceConfigMap[P]['state']): unknown;

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
   * Implementation note: Each protocol defines its own discovery input type
   * via PoolPriceDiscoverInputMap. For example, Uniswap V3 uses { blockNumber: number }.
   *
   * Discovery should:
   * 1. Fetch pool from database (to get pool config and token info)
   * 2. Check database for existing price at block (idempotent)
   * 3. Validate chain support
   * 4. Fetch block info (timestamp) from blockchain
   * 5. Read pool state (e.g., slot0) at specific block
   * 6. Calculate token prices from pool state
   * 7. Save to database and return PoolPrice
   *
   * @param poolId - Pool ID (common parameter for all protocols)
   * @param params - Discovery parameters (type-safe via PoolPriceDiscoverInputMap[P])
   * @returns The discovered or existing pool price snapshot
   * @throws Error if discovery fails (protocol-specific errors)
   */
  abstract discover(
    poolId: string,
    params: PoolPriceDiscoverInput<P>
  ): Promise<PoolPrice<P>>;

  // ============================================================================
  // CRUD OPERATIONS
  // Base implementations for pool price management
  // Protocol implementations SHOULD override to add type filtering and validation
  // ============================================================================

  /**
   * Create a new pool price snapshot
   *
   * Base implementation that handles database operations.
   * Derived classes should override this method to add validation.
   *
   * Note: Pool prices are typically created via a discovery/fetch mechanism
   * that reads historic blockchain data. This method is a low-level helper.
   *
   * @param input - Pool price data to create (omits id, createdAt, updatedAt)
   * @returns The created pool price with generated id and timestamps
   */
  async create(input: CreatePoolPriceInput<P>): Promise<PoolPrice<P>> {
    log.methodEntry(this.logger, 'create', {
      protocol: input.protocol,
      poolId: input.poolId,
      timestamp: input.timestamp,
    });

    try {
      // Serialize config and state for database storage
      const configDB = this.serializeConfig(input.config);
      const stateDB = this.serializeState(input.state);

      log.dbOperation(this.logger, 'create', 'PoolPrice', {
        protocol: input.protocol,
        poolId: input.poolId,
      });

      const result = await this.prisma.poolPrice.create({
        data: {
          protocol: input.protocol,
          poolId: input.poolId,
          timestamp: input.timestamp,
          token1PricePerToken0: input.token1PricePerToken0.toString(),
          token0PricePerToken1: input.token0PricePerToken1.toString(),
          config: configDB as object,
          state: stateDB as object,
        },
      });

      const poolPrice = this.mapToPoolPrice(result as PoolPriceDbResult);

      this.logger.info(
        {
          id: poolPrice.id,
          protocol: poolPrice.protocol,
          poolId: poolPrice.poolId,
          timestamp: poolPrice.timestamp,
        },
        'Pool price created'
      );
      log.methodExit(this.logger, 'create', { id: poolPrice.id });
      return poolPrice;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        protocol: input.protocol,
      });
      throw error;
    }
  }

  /**
   * Find pool price by ID
   *
   * Base implementation returns pool price data.
   * Protocol-specific implementations should override to filter by protocol type.
   *
   * @param id - Pool price ID
   * @returns Pool price if found, null otherwise
   */
  async findById(id: string): Promise<PoolPrice<P> | null> {
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
  async findByPoolId(poolId: string): Promise<PoolPrice<P>[]> {
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
  ): Promise<PoolPrice<P>[]> {
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
   * Update pool price
   *
   * Generic helper for rare manual updates.
   * Pool prices are typically immutable historical records, so updates are rare.
   * This might be used for corrections or re-calculations.
   *
   * Base implementation performs the update and returns the result.
   * Protocol-specific implementations should override to add validation.
   *
   * @param id - Pool price ID
   * @param input - Update input with optional fields
   * @returns Updated pool price
   * @throws Error if pool price not found
   */
  async update(id: string, input: UpdatePoolPriceInput<P>): Promise<PoolPrice<P>> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      const data: any = {};

      if (input.timestamp !== undefined) {
        data.timestamp = input.timestamp;
      }

      if (input.token1PricePerToken0 !== undefined) {
        data.token1PricePerToken0 = input.token1PricePerToken0.toString();
      }

      if (input.token0PricePerToken1 !== undefined) {
        data.token0PricePerToken1 = input.token0PricePerToken1.toString();
      }

      if (input.config !== undefined) {
        data.config = this.serializeConfig(input.config) as object;
      }

      if (input.state !== undefined) {
        data.state = this.serializeState(input.state) as object;
      }

      log.dbOperation(this.logger, 'update', 'PoolPrice', {
        id,
        fields: Object.keys(data),
      });

      const result = await this.prisma.poolPrice.update({
        where: { id },
        data,
      });

      const poolPrice = this.mapToPoolPrice(result as PoolPriceDbResult);

      log.methodExit(this.logger, 'update', { id });
      return poolPrice;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id });
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
   * Map database result to PoolPrice type
   *
   * Converts string values to bigint for price fields and calls
   * parseConfig/parseState for config/state deserialization.
   *
   * @param dbResult - Raw database result
   * @returns PoolPrice with native types
   */
  protected mapToPoolPrice(dbResult: PoolPriceDbResult): PoolPrice<P> {
    return {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      protocol: dbResult.protocol as P,
      poolId: dbResult.poolId,
      timestamp: dbResult.timestamp,
      token1PricePerToken0: BigInt(dbResult.token1PricePerToken0),
      token0PricePerToken1: BigInt(dbResult.token0PricePerToken1),
      config: this.parseConfig(dbResult.config),
      state: this.parseState(dbResult.state),
    };
  }
}
