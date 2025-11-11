/**
 * Abstract Pool Service
 *
 * Base class for protocol-specific pool services.
 * Handles serialization/deserialization of config and state between
 * database JSON format and application types.
 *
 * Protocol implementations (e.g., UniswapV3PoolService) must implement
 * all abstract serialization and discovery methods.
 */

import { PrismaClient } from '@midcurve/database';
import type { Pool, PoolConfigMap } from '@midcurve/shared';
import type {
  PoolDiscoverInput,
  CreatePoolInput,
  UpdatePoolInput,
} from '../types/pool/pool-input.js';
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
 * Abstract PoolService
 *
 * Provides base functionality for pool management.
 * Protocol-specific services must extend this class and implement
 * serialization methods for config and state.
 *
 * Key difference from Token/Position services:
 * - Pool contains full Token objects in TypeScript
 * - Database stores only token IDs (token0Id, token1Id)
 * - Derived classes must fetch and populate full Token objects
 *
 * @template P - Protocol key from PoolConfigMap ('uniswapv3', etc.)
 */
export abstract class PoolService<P extends keyof PoolConfigMap> {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

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
  abstract parseConfig(configDB: unknown): PoolConfigMap[P]['config'];

  /**
   * Serialize config from application type to database JSON
   *
   * Converts native values (if any) to serializable types.
   * For configs with only primitives, this may be a pass-through.
   *
   * @param config - Application config with native types
   * @returns Serialized config for database storage
   */
  abstract serializeConfig(config: PoolConfigMap[P]['config']): unknown;

  /**
   * Parse state from database JSON to application type
   *
   * Converts serialized values (e.g., bigint strings) to native types.
   *
   * @param stateDB - State object from database (JSON with string values)
   * @returns Parsed state with native types (bigint, etc.)
   */
  abstract parseState(stateDB: unknown): PoolConfigMap[P]['state'];

  /**
   * Serialize state from application type to database JSON
   *
   * Converts native values (e.g., bigint) to serializable types (strings).
   *
   * @param state - Application state with native types
   * @returns Serialized state for database storage
   */
  abstract serializeState(state: PoolConfigMap[P]['state']): unknown;

  // ============================================================================
  // ABSTRACT DISCOVERY METHOD
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Discover and create a pool from on-chain data
   *
   * Checks the database first for an existing pool. If not found, reads
   * pool configuration from on-chain sources, discovers/fetches tokens,
   * and creates a new pool entry with full Token objects.
   *
   * Implementation note: Each protocol defines its own discovery input type
   * via PoolDiscoverInputMap. For example, Uniswap V3 uses { poolAddress: string, chainId: number }.
   *
   * Discovery should:
   * 1. Check database first (idempotent)
   * 2. Read immutable pool config from on-chain (token addresses, fee, tickSpacing)
   * 3. Discover/fetch Token objects for token0 and token1
   * 4. Create zero-default state (actual state fetched via refresh() later)
   * 5. Save to database and return Pool with full Token objects
   *
   * @param params - Discovery parameters (type-safe via PoolDiscoverInputMap[P])
   * @returns The discovered or existing pool with full Token objects
   * @throws Error if discovery fails (protocol-specific errors)
   */
  abstract discover(params: PoolDiscoverInput<P>): Promise<Pool<P>>;

  // ============================================================================
  // CRUD OPERATIONS
  // Base implementations without Token population
  // Protocol implementations SHOULD override to add type filtering and Token population
  // ============================================================================

  /**
   * Create a new pool
   *
   * Base implementation that handles database operations.
   * Derived classes should override this method to add validation,
   * normalization, and to populate full Token objects in the result.
   *
   * Note: This is a manual creation helper. For creating pools from on-chain data,
   * use discover() which handles token discovery and pool state fetching.
   *
   * @param input - Pool data to create (omits id, createdAt, updatedAt, and full Token objects)
   * @returns The created pool with generated id and timestamps (without full Token objects in base)
   */
  async create(input: CreatePoolInput<P>): Promise<Pool<P>> {
    log.methodEntry(this.logger, 'create', {
      protocol: input.protocol,
      token0Id: input.token0Id,
      token1Id: input.token1Id,
    });

    try {
      // Serialize config and state for database storage
      const configDB = this.serializeConfig(input.config);
      const stateDB = this.serializeState(input.state);

      log.dbOperation(this.logger, 'create', 'Pool', {
        protocol: input.protocol,
        poolType: input.poolType,
      });

      const result = await this.prisma.pool.create({
        data: {
          protocol: input.protocol,
          poolType: input.poolType,
          token0Id: input.token0Id,
          token1Id: input.token1Id,
          feeBps: input.feeBps,
          config: configDB as object,
          state: stateDB as object,
        },
        include: {
          token0: true,
          token1: true,
        },
      });

      // Parse config and state
      const config = this.parseConfig(result.config);
      const state = this.parseState(result.state);

      const pool = {
        id: result.id,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        protocol: result.protocol as P,
        poolType: result.poolType,
        token0: result.token0 as any, // Base class doesn't know token type
        token1: result.token1 as any,
        feeBps: result.feeBps,
        config,
        state,
      } as Pool<P>;

      this.logger.info(
        {
          id: pool.id,
          protocol: pool.protocol,
          poolType: pool.poolType,
        },
        'Pool created'
      );
      log.methodExit(this.logger, 'create', { id: pool.id });
      return pool;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        protocol: input.protocol,
      });
      throw error;
    }
  }

  /**
   * Find pool by ID
   *
   * Base implementation returns pool data without populating full Token objects.
   * Protocol-specific implementations should override to:
   * - Filter by protocol type
   * - Populate full Token objects
   *
   * @param id - Pool ID
   * @returns Pool if found, null otherwise
   */
  async findById(id: string): Promise<Pool<P> | null> {
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
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      // Parse config and state
      const config = this.parseConfig(result.config);
      const state = this.parseState(result.state);

      // Note: Token objects are returned as-is from database
      // Derived classes should override to map to proper Token<T> types
      const pool = {
        id: result.id,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        protocol: result.protocol as P,
        poolType: result.poolType,
        token0: result.token0 as any, // Base class doesn't know token type
        token1: result.token1 as any,
        feeBps: result.feeBps,
        config,
        state,
      } as Pool<P>;

      log.methodExit(this.logger, 'findById', { id, found: true });
      return pool;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Update pool
   *
   * Generic helper for rare manual updates.
   * - Config updates are rare (pool parameters are immutable on-chain)
   * - State updates should typically use refresh() method
   *
   * Base implementation performs the update and returns the result.
   * Protocol-specific implementations should override to add validation.
   *
   * @param id - Pool ID
   * @param input - Update input with optional fields
   * @returns Updated pool with full Token objects
   * @throws Error if pool not found
   */
  async update(id: string, input: UpdatePoolInput<P>): Promise<Pool<P>> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      // Serialize config and state if provided
      const data: any = {};

      if (input.feeBps !== undefined) {
        data.feeBps = input.feeBps;
      }

      if (input.config !== undefined) {
        data.config = this.serializeConfig(input.config) as object;
      }

      if (input.state !== undefined) {
        data.state = this.serializeState(input.state) as object;
      }

      log.dbOperation(this.logger, 'update', 'Pool', { id, fields: Object.keys(data) });

      const result = await this.prisma.pool.update({
        where: { id },
        data,
        include: {
          token0: true,
          token1: true,
        },
      });

      // Parse config and state
      const config = this.parseConfig(result.config);
      const state = this.parseState(result.state);

      const pool = {
        id: result.id,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        protocol: result.protocol as P,
        poolType: result.poolType,
        token0: result.token0 as any,
        token1: result.token1 as any,
        feeBps: result.feeBps,
        config,
        state,
      } as Pool<P>;

      log.methodExit(this.logger, 'update', { id });
      return pool;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete pool
   *
   * Base implementation silently succeeds if pool doesn't exist.
   * Protocol-specific implementations should override to:
   * - Verify protocol type (error if wrong protocol)
   * - Check for dependent positions (prevent deletion if positions exist)
   *
   * @param id - Pool ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      log.dbOperation(this.logger, 'delete', 'Pool', { id });

      await this.prisma.pool.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id, deleted: true });
    } catch (error: any) {
      // P2025 = Record not found
      if (error.code === 'P2025') {
        this.logger.debug({ id }, 'Pool not found, delete operation is no-op');
        log.methodExit(this.logger, 'delete', { id, deleted: false });
        return;
      }

      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }
}
