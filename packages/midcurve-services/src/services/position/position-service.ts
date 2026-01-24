/**
 * Abstract Position Service
 *
 * Base class for protocol-specific position services.
 *
 * Protocol implementations (e.g., UniswapV3PositionService) must implement
 * the abstract discover(), refresh(), reset(), and createPositionHash() methods.
 * They should also override CRUD methods to add protocol filtering and use
 * protocol-specific class factories.
 *
 * Uses the OOP inheritance pattern from @midcurve/shared:
 * - PositionInterface for polymorphic handling
 * - PositionFactory for creating instances from database rows
 * - Concrete classes (UniswapV3Position) for type-safe config/state access
 */

import { PrismaClient } from '@midcurve/database';
import type { PositionInterface, PositionProtocol, PositionRow } from '@midcurve/shared';
import { PositionFactory, UniswapV3Pool, PoolFactory, Erc20Token } from '@midcurve/shared';
import type { Erc20TokenRow, UniswapV3PoolRow } from '@midcurve/shared';
import type {
  CreateAnyPositionInput,
  UpdateAnyPositionInput,
} from '../types/position/position-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for PositionService
 * All dependencies are optional and will use defaults if not provided
 */
export interface PositionServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Database result interface for position queries.
 * Note: Prisma stores bigint as string in the database, so we use string here.
 * The mapToPosition method handles conversion to native bigint for PositionRow.
 */
export interface PositionDbResult {
  id: string;
  positionHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  protocol: string;
  positionType: string;
  userId: string;
  currentValue: string; // Prisma returns bigint as string
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
  pool: any; // Pool with token0, token1 from include
  positionOpenedAt: Date;
  positionClosedAt: Date | null;
  isActive: boolean;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Abstract PositionService
 *
 * Provides base functionality for position management.
 * Protocol-specific services must extend this class and implement
 * the abstract methods.
 */
export abstract class PositionService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  /**
   * Protocol identifier for this service
   * Concrete classes must define this (e.g., 'uniswapv3')
   */
  protected abstract readonly protocol: PositionProtocol;

  /**
   * Creates a new PositionService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: PositionServiceDependencies = {}) {
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
  // ABSTRACT METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Create position hash for database lookups
   *
   * Generates a human-readable composite key from position identifiers.
   * Used for fast indexed lookups instead of slow JSONB queries.
   *
   * Format is protocol-specific:
   * - UniswapV3: "uniswapv3/{chainId}/{nftId}"
   * - Orca (future): "orca/{programId}/{positionPubkey}"
   * - etc.
   *
   * Requirements:
   * - Must be unique across all positions for the given protocol
   * - Should be human-readable for debugging
   * - Use "/" as separator for consistency
   * - Include protocol prefix for global uniqueness
   *
   * @param config - Position configuration (protocol-specific)
   * @returns Human-readable position hash
   *
   * @example
   * // UniswapV3
   * createPositionHash({ chainId: 1, nftId: 123456, poolAddress: '0x...', tickLower: -1000, tickUpper: 1000 })
   * // Returns: "uniswapv3/1/123456"
   */
  abstract createPositionHash(config: Record<string, unknown>): string;

  // ============================================================================
  // ABSTRACT DISCOVERY METHOD
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Discover and create a position from on-chain data
   *
   * Checks the database first for an existing position. If not found, reads
   * position configuration and state from on-chain sources (NFT contract),
   * discovers/fetches the pool and tokens, determines token roles (base/quote),
   * and creates a new position entry.
   *
   * Discovery should:
   * 1. Check database first (idempotent)
   * 2. Read immutable position config from on-chain (NFT ID, ticks, pool address)
   * 3. Discover/fetch the Pool and its tokens
   * 4. Determine which token is base and which is quote based on quoteTokenAddress
   * 5. Read current position state from on-chain (liquidity, fees, etc.)
   * 6. Calculate initial PnL and price range values
   * 7. Save to database and return Position
   *
   * @param userId - User ID who owns this position (database foreign key to User.id)
   * @param params - Discovery parameters (protocol-specific)
   * @returns The discovered or existing position
   * @throws Error if discovery fails (protocol-specific errors)
   */
  abstract discover(
    userId: string,
    params: unknown
  ): Promise<PositionInterface>;

  // ============================================================================
  // ABSTRACT REFRESH METHOD
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Refresh position state from on-chain data
   *
   * Fetches the current position state from the blockchain and updates the database.
   * This is the primary method for updating position state (vs update() which is a generic helper).
   *
   * Note: Only updates mutable state fields (liquidity, feeGrowth, tokensOwed).
   * Config fields (chainId, nftId, ticks) are immutable and not updated.
   * Also recalculates PnL fields (currentValue, unrealizedPnl) based on fresh state.
   *
   * @param id - Position ID
   * @returns Updated position with fresh on-chain state
   * @throws Error if position not found
   * @throws Error if position is not the correct protocol
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  abstract refresh(id: string): Promise<PositionInterface>;

  /**
   * Reset position by rediscovering all ledger events from blockchain
   *
   * Completely rebuilds the position's ledger history by:
   * 1. Deleting all existing ledger events and APR periods
   * 2. Rediscovering all events from blockchain (via Etherscan or similar)
   * 3. Recalculating APR periods from fresh events
   * 4. Refreshing position state from on-chain data
   * 5. Recalculating PnL fields based on fresh ledger data
   *
   * Use this when:
   * - Ledger data may be corrupted or incomplete
   * - Manual intervention is needed to rebuild position history
   * - Testing or debugging position calculations
   *
   * Warning: This is a destructive operation that deletes existing event history.
   * The blockchain is the source of truth, so events will be identical after rebuild,
   * but database IDs and timestamps will change.
   *
   * @param id - Position ID
   * @returns Position with completely rebuilt ledger and refreshed state
   * @throws Error if position not found
   * @throws Error if position is not the correct protocol
   * @throws Error if chain is not supported
   * @throws Error if blockchain data fetch fails
   */
  abstract reset(id: string): Promise<PositionInterface>;

  // ============================================================================
  // CRUD OPERATIONS
  // Base implementations without protocol-specific validation
  // Protocol implementations SHOULD override to add type filtering
  // ============================================================================

  /**
   * Create a new position
   *
   * Base implementation that handles database operations.
   * Derived classes should override this method to add validation
   * and protocol-specific serialization.
   *
   * Note: This is a manual creation helper. For creating positions from on-chain data,
   * use discover() which handles pool discovery, token role determination, and state fetching.
   *
   * Implementation handles:
   * - Conversion of bigint fields to strings for database storage
   * - Default values for calculated fields (PnL, fees, price range)
   *
   * @param input - Position data to create (omits id, createdAt, updatedAt, calculated fields)
   * @param configDB - Serialized config for database storage
   * @param stateDB - Serialized state for database storage
   * @returns The created position with generated id and timestamps
   */
  async create(
    input: CreateAnyPositionInput,
    configDB: Record<string, unknown>,
    stateDB: Record<string, unknown>
  ): Promise<PositionInterface> {
    log.methodEntry(this.logger, 'create', {
      protocol: input.protocol,
      userId: input.userId,
      poolId: input.poolId,
    });

    try {
      // Generate position hash for fast lookups
      // Cast config to generic Record for createPositionHash which is protocol-agnostic
      const positionHash = this.createPositionHash(
        input.config as unknown as Record<string, unknown>
      );

      // Default calculated values (will be computed properly in discover())
      const now = new Date();
      const zeroValue = '0';

      log.dbOperation(this.logger, 'create', 'Position', {
        protocol: input.protocol,
        positionType: input.positionType,
        userId: input.userId,
        positionHash,
      });

      const result = await this.prisma.position.create({
        data: {
          protocol: input.protocol,
          positionType: input.positionType,
          userId: input.userId,
          poolId: input.poolId,
          isToken0Quote: input.isToken0Quote,
          positionHash,
          config: configDB as object,
          state: stateDB as object,
          // Default calculated values
          currentValue: zeroValue,
          currentCostBasis: zeroValue,
          realizedPnl: zeroValue,
          unrealizedPnl: zeroValue,
          // Cash flow fields for non-AMM protocols (always 0 for UniswapV3)
          realizedCashflow: zeroValue,
          unrealizedCashflow: zeroValue,
          collectedFees: zeroValue,
          unClaimedFees: zeroValue,
          lastFeesCollectedAt: now,
          priceRangeLower: zeroValue,
          priceRangeUpper: zeroValue,
          positionOpenedAt: input.positionOpenedAt ?? now,
          positionClosedAt: null,
          isActive: true,
        },
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });

      // Map database result to Position type
      const position = this.mapToPosition(result as PositionDbResult);

      this.logger.info(
        {
          id: position.id,
          protocol: position.protocol,
          positionType: position.positionType,
          userId: position.userId,
        },
        'Position created'
      );
      log.methodExit(this.logger, 'create', { id: position.id });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        protocol: input.protocol,
      });
      throw error;
    }
  }

  /**
   * Find position by ID
   *
   * Base implementation returns position data.
   * Protocol-specific implementations should override to:
   * - Filter by protocol type
   * - Return protocol-specific position class
   *
   * @param id - Position ID
   * @returns Position if found, null otherwise
   */
  async findById(id: string): Promise<PositionInterface | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'Position', { id });

      const result = await this.prisma.position.findUnique({
        where: { id },
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      // Map to Position type
      const position = this.mapToPosition(result as PositionDbResult);

      log.methodExit(this.logger, 'findById', { id, found: true });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find position by user ID and position hash
   *
   * Fast indexed lookup using positionHash field.
   * Replaces slow JSONB queries for position lookups.
   *
   * @param userId - User ID (ensures user can only access their positions)
   * @param positionHash - Position hash (generated by createPositionHash)
   * @returns Position if found, null otherwise
   */
  async findByPositionHash(userId: string, positionHash: string): Promise<PositionInterface | null> {
    log.methodEntry(this.logger, 'findByPositionHash', { userId, positionHash });

    try {
      log.dbOperation(this.logger, 'findFirst', 'Position', { userId, positionHash });

      const result = await this.prisma.position.findFirst({
        where: {
          userId,
          positionHash,
        },
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });

      if (!result) {
        log.methodExit(this.logger, 'findByPositionHash', { userId, positionHash, found: false });
        return null;
      }

      // Map to Position type
      const position = this.mapToPosition(result as PositionDbResult);

      log.methodExit(this.logger, 'findByPositionHash', { userId, positionHash, found: true });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'findByPositionHash', error as Error, { userId, positionHash });
      throw error;
    }
  }

  /**
   * Update position
   *
   * Generic helper for rare manual updates.
   * - Config updates are rare (position parameters are immutable on-chain)
   * - State updates should typically use refresh() method
   * - Calculated fields (PnL, fees) should be recomputed after state changes
   *
   * Base implementation performs the update and returns the result.
   * Protocol-specific implementations should override to add validation.
   *
   * @param id - Position ID
   * @param input - Update input with optional fields
   * @returns Updated position
   * @throws Error if position not found
   */
  async update(id: string, input: UpdateAnyPositionInput): Promise<PositionInterface> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      // Currently, UpdateAnyPositionInput has no mutable fields
      // All updates should use refresh() method for state updates
      const data: Record<string, unknown> = {};

      log.dbOperation(this.logger, 'update', 'Position', {
        id,
        fields: Object.keys(data),
      });

      const result = await this.prisma.position.update({
        where: { id },
        data,
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });

      // Map to Position type
      const position = this.mapToPosition(result as PositionDbResult);

      log.methodExit(this.logger, 'update', { id });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete position
   *
   * Base implementation silently succeeds if position doesn't exist.
   * Protocol-specific implementations should override to:
   * - Verify protocol type (error if wrong protocol)
   *
   * @param id - Position ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      log.dbOperation(this.logger, 'delete', 'Position', { id });

      await this.prisma.position.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id, deleted: true });
    } catch (error: any) {
      // P2025 = Record not found
      if (error.code === 'P2025') {
        this.logger.debug({ id }, 'Position not found, delete operation is no-op');
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
   * Map database result to PositionInterface using factory
   *
   * Converts string values to bigint for numeric fields, creates pool instance,
   * and uses PositionFactory to create protocol-specific position class.
   *
   * @param dbResult - Raw database result from Prisma
   * @returns PositionInterface instance
   */
  protected mapToPosition(dbResult: PositionDbResult): PositionInterface {
    // Create token instances from included pool data
    const token0 = Erc20Token.fromDB(dbResult.pool.token0 as Erc20TokenRow);
    const token1 = Erc20Token.fromDB(dbResult.pool.token1 as Erc20TokenRow);

    // Create pool instance from included pool data
    const poolRow = dbResult.pool as UniswapV3PoolRow;
    const pool = PoolFactory.fromDB(poolRow, token0, token1) as UniswapV3Pool;

    // Convert string bigint fields to native bigint
    const rowWithBigInt: PositionRow = {
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
      pool: dbResult.pool,
    };

    // Use factory to create protocol-specific position class
    return PositionFactory.fromDB(rowWithBigInt, pool);
  }
}
