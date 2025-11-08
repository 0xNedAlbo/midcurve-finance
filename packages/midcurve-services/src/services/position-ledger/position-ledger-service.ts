/**
 * Abstract Position Ledger Service
 *
 * Base class for protocol-specific position ledger services.
 * Handles serialization/deserialization of config and state between
 * database JSON format and application types.
 *
 * Position ledger events are immutable and form a linked list (via previousId).
 * Events track PnL, cost basis, and cash flows for concentrated liquidity positions.
 *
 * Protocol implementations (e.g., UniswapV3PositionLedgerService) must implement:
 * - Config/State serialization methods
 * - Input hash generation
 * - Discovery methods (fetching events from blockchain)
 */

import { PrismaClient } from '@prisma/client';
import type {
  PositionLedgerEvent,
  PositionLedgerEventConfigMap,
  PositionLedgerEventStateMap,
  EventType,
  Reward,
} from '@midcurve/shared';
import type {
  CreatePositionLedgerEventInput,
  PositionLedgerEventDiscoverInput,
} from '../types/position-ledger/position-ledger-event-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { PositionAprService } from '../position-apr/position-apr-service.js';

/**
 * Dependencies for PositionLedgerService
 * All dependencies are optional and will use defaults if not provided
 */
export interface PositionLedgerServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * Position APR service for calculating fee-based returns
   * If not provided, a new PositionAprService instance will be created
   * APR calculation is mandatory and runs automatically after ledger discovery
   */
  aprService?: PositionAprService;
}

/**
 * Generic ledger event result from database (before deserialization)
 */
export interface LedgerEventDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  positionId: string;
  protocol: string;
  previousId: string | null;
  timestamp: Date;
  eventType: string;
  inputHash: string;
  poolPrice: string;
  token0Amount: string;
  token1Amount: string;
  tokenValue: string;
  rewards: unknown;
  deltaCostBasis: string;
  costBasisAfter: string;
  deltaPnl: string;
  pnlAfter: string;
  config: unknown;
  state: unknown;
}

/**
 * Abstract PositionLedgerService
 *
 * Provides base functionality for position ledger event management.
 * Protocol-specific services must extend this class and implement
 * serialization and discovery methods.
 *
 * @template P - Protocol key from PositionLedgerEventConfigMap ('uniswapv3', etc.)
 */
export abstract class PositionLedgerService<
  P extends keyof PositionLedgerEventConfigMap,
> {
  protected readonly _prisma: PrismaClient;
  protected readonly _aprService: PositionAprService;
  protected readonly logger: ServiceLogger;

  /**
   * Creates a new PositionLedgerService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.aprService - APR service instance (creates default if not provided)
   */
  constructor(dependencies: PositionLedgerServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this._aprService = dependencies.aprService ?? new PositionAprService({ prisma: this._prisma });
    this.logger = createServiceLogger(this.constructor.name);
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get the APR service instance
   */
  protected get aprService(): PositionAprService {
    return this._aprService;
  }

  // ============================================================================
  // ABSTRACT SERIALIZATION METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   *
   * Converts serialized values (bigint as strings) to native types.
   *
   * @param configDB - Config object from database (JSON)
   * @returns Parsed config with native types
   */
  abstract parseConfig(
    configDB: unknown
  ): PositionLedgerEventConfigMap[P]['config'];

  /**
   * Serialize config from application type to database JSON
   *
   * Converts native values (bigint) to serializable types (strings).
   *
   * @param config - Application config with native types
   * @returns Serialized config for database storage
   */
  abstract serializeConfig(
    config: PositionLedgerEventConfigMap[P]['config']
  ): unknown;

  /**
   * Parse state from database JSON to application type
   *
   * Converts serialized values (bigint as strings) to native types.
   *
   * @param stateDB - State object from database (JSON)
   * @returns Parsed state with native types
   */
  abstract parseState(
    stateDB: unknown
  ): PositionLedgerEventStateMap[P]['state'];

  /**
   * Serialize state from application type to database JSON
   *
   * Converts native values (bigint) to serializable types (strings).
   *
   * @param state - Application state with native types
   * @returns Serialized state for database storage
   */
  abstract serializeState(
    state: PositionLedgerEventStateMap[P]['state']
  ): unknown;

  // ============================================================================
  // ABSTRACT HASH GENERATION
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Generate input hash for deduplication
   *
   * Creates a unique hash from event input to prevent duplicates.
   * Typically uses blockchain coordinates (blockNumber, txIndex, logIndex).
   *
   * @param input - Event creation input
   * @returns Unique hash string (e.g., MD5 of coordinates)
   */
  abstract generateInputHash(input: CreatePositionLedgerEventInput<P>): string;

  // ============================================================================
  // ABSTRACT DISCOVERY METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Discover all events for a position from blockchain
   *
   * Fetches complete event history from blockchain data sources (e.g., Etherscan).
   * Deletes existing events and rebuilds the ledger from genesis.
   *
   * Implementation steps:
   * 1. Delete all existing events for position
   * 2. Fetch raw events from blockchain
   * 3. Parse and deduplicate events
   * 4. Sort by blockchain order (block, txIndex, logIndex)
   * 5. Build state sequentially (calculate PnL, cost basis)
   * 6. Save all events
   * 7. Return complete history (descending order by timestamp)
   *
   * @param positionId - Position database ID
   * @returns Complete event history, sorted descending by timestamp (newest first)
   * @throws Error if discovery fails
   */
  abstract discoverAllEvents(
    positionId: string
  ): Promise<PositionLedgerEvent<P>[]>;

  /**
   * Discover and add a single event to position ledger
   *
   * Adds a new event to the end of the event chain.
   * Validates event sequence and calculates financial data based on previous state.
   *
   * Implementation steps:
   * 1. Validate event can be added (after last event, same protocol)
   * 2. Fetch previous event state
   * 3. Calculate new state from previous + current event
   * 4. Save event
   * 5. Return complete history (descending order by timestamp)
   *
   * @param positionId - Position database ID
   * @param input - Discovery input with raw event data
   * @returns Complete event history, sorted descending by timestamp (newest first)
   * @throws Error if event cannot be added or discovery fails
   */
  abstract discoverEvent(
    positionId: string,
    input: PositionLedgerEventDiscoverInput<P>
  ): Promise<PositionLedgerEvent<P>[]>;

  // ============================================================================
  // PROTECTED HELPERS
  // ============================================================================

  /**
   * Map database result to PositionLedgerEvent type
   *
   * Calls parseConfig/parseState for deserialization.
   * Converts string values to bigint for financial fields.
   *
   * @param dbResult - Raw database result
   * @returns PositionLedgerEvent with native types
   */
  protected mapToLedgerEvent(
    dbResult: LedgerEventDbResult
  ): PositionLedgerEvent<P> {
    // Parse rewards array
    const rewardsDB = dbResult.rewards as Array<{
      tokenId: string;
      tokenAmount: string;
      tokenValue: string;
    }>;

    const rewards: Reward[] = rewardsDB.map((r) => ({
      tokenId: r.tokenId,
      tokenAmount: BigInt(r.tokenAmount),
      tokenValue: BigInt(r.tokenValue),
    }));

    return {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      positionId: dbResult.positionId,
      protocol: dbResult.protocol as P,
      previousId: dbResult.previousId,
      timestamp: dbResult.timestamp,
      eventType: dbResult.eventType as EventType,
      inputHash: dbResult.inputHash,
      poolPrice: BigInt(dbResult.poolPrice),
      token0Amount: BigInt(dbResult.token0Amount),
      token1Amount: BigInt(dbResult.token1Amount),
      tokenValue: BigInt(dbResult.tokenValue),
      rewards,
      deltaCostBasis: BigInt(dbResult.deltaCostBasis),
      costBasisAfter: BigInt(dbResult.costBasisAfter),
      deltaPnl: BigInt(dbResult.deltaPnl),
      pnlAfter: BigInt(dbResult.pnlAfter),
      config: this.parseConfig(dbResult.config),
      state: this.parseState(dbResult.state),
    };
  }

  /**
   * Validate event sequence
   *
   * Ensures:
   * - Event is added after last event (if previousId provided)
   * - Previous event exists and belongs to same position
   * - Previous event is same protocol
   *
   * @param positionId - Position database ID
   * @param previousId - Previous event ID (null for first event)
   * @param protocol - Protocol identifier
   * @throws Error if validation fails
   */
  protected async validateEventSequence(
    positionId: string,
    previousId: string | null,
    protocol: string
  ): Promise<void> {
    log.methodEntry(this.logger, 'validateEventSequence', {
      positionId,
      previousId,
      protocol,
    });

    try {
      // If no previous event, this is the first event
      if (!previousId) {
        this.logger.debug({ positionId }, 'First event in chain, no validation needed');
        log.methodExit(this.logger, 'validateEventSequence', {
          firstEvent: true,
        });
        return;
      }

      // Verify previous event exists
      log.dbOperation(this.logger, 'findUnique', 'PositionLedgerEvent', {
        id: previousId,
      });

      const previousEvent = await this.prisma.positionLedgerEvent.findUnique({
        where: { id: previousId },
      });

      if (!previousEvent) {
        const error = new Error(
          `Previous event ${previousId} not found for position ${positionId}`
        );
        log.methodError(this.logger, 'validateEventSequence', error, {
          positionId,
          previousId,
        });
        throw error;
      }

      // Verify previous event belongs to same position
      if (previousEvent.positionId !== positionId) {
        const error = new Error(
          `Previous event ${previousId} belongs to position ${previousEvent.positionId}, not ${positionId}`
        );
        log.methodError(this.logger, 'validateEventSequence', error, {
          positionId,
          previousId,
          previousPositionId: previousEvent.positionId,
        });
        throw error;
      }

      // Verify previous event is same protocol
      if (previousEvent.protocol !== protocol) {
        const error = new Error(
          `Previous event ${previousId} is protocol ${previousEvent.protocol}, not ${protocol}`
        );
        log.methodError(this.logger, 'validateEventSequence', error, {
          positionId,
          previousId,
          expectedProtocol: protocol,
          actualProtocol: previousEvent.protocol,
        });
        throw error;
      }

      this.logger.debug(
        {
          positionId,
          previousId,
          protocol,
        },
        'Event sequence validated successfully'
      );

      log.methodExit(this.logger, 'validateEventSequence', {
        positionId,
        previousId,
      });
    } catch (error) {
      // Only log if not already logged
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('belongs to') ||
            error.message.includes('is protocol'))
        )
      ) {
        log.methodError(this.logger, 'validateEventSequence', error as Error, {
          positionId,
          previousId,
        });
      }
      throw error;
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Find all events for a position
   *
   * Returns events in descending order by timestamp (newest first).
   * This is the standard order for UI display.
   *
   * @param positionId - Position database ID
   * @returns Array of events, sorted descending by timestamp
   */
  async findAllItems(positionId: string): Promise<PositionLedgerEvent<P>[]> {
    log.methodEntry(this.logger, 'findAllItems', { positionId });

    try {
      log.dbOperation(this.logger, 'findMany', 'PositionLedgerEvent', {
        positionId,
      });

      const results = await this.prisma.positionLedgerEvent.findMany({
        where: {
          positionId,
          protocol: String(this.constructor.name.toLowerCase().replace('positionledgerservice', '')),
        },
        orderBy: {
          timestamp: 'desc',
        },
      });

      const events = results.map((r) =>
        this.mapToLedgerEvent(r as LedgerEventDbResult)
      );

      this.logger.debug(
        {
          positionId,
          count: events.length,
        },
        'Events retrieved successfully'
      );

      log.methodExit(this.logger, 'findAllItems', {
        positionId,
        count: events.length,
      });
      return events;
    } catch (error) {
      log.methodError(this.logger, 'findAllItems', error as Error, {
        positionId,
      });
      throw error;
    }
  }

  /**
   * Get the most recent ledger event for a position
   *
   * Events are returned from findAllItems() sorted in DESCENDING order by timestamp,
   * so the first element is always the most recent event.
   *
   * IMPORTANT: This ordering is critical for correctness. The most recent event contains
   * the final state after all historical operations (INCREASE, DECREASE, COLLECT).
   *
   * All event types (INCREASE_POSITION, DECREASE_POSITION, COLLECT) include final state
   * in their config (e.g., liquidityAfter, feeGrowthInside0LastX128, etc.). Even COLLECT
   * events pass through the liquidity value from the previous event.
   *
   * @param positionId - Position database ID
   * @returns Most recent event, or null if no events exist
   */
  async getMostRecentEvent(
    positionId: string
  ): Promise<PositionLedgerEvent<P> | null> {
    log.methodEntry(this.logger, 'getMostRecentEvent', { positionId });

    try {
      const events = await this.findAllItems(positionId);

      if (events.length === 0) {
        log.methodExit(this.logger, 'getMostRecentEvent', {
          positionId,
          found: false,
        });
        return null;
      }

      // First element is most recent (DESC order by timestamp)
      const mostRecentEvent = events[0]!;

      log.methodExit(this.logger, 'getMostRecentEvent', {
        positionId,
        eventId: mostRecentEvent.id,
        eventType: mostRecentEvent.eventType,
        timestamp: mostRecentEvent.timestamp,
      });

      return mostRecentEvent;
    } catch (error) {
      log.methodError(this.logger, 'getMostRecentEvent', error as Error, {
        positionId,
      });
      throw error;
    }
  }

  /**
   * Add a new event to position ledger
   *
   * Validates event sequence and saves to database.
   * Returns complete event history after addition.
   *
   * @param positionId - Position database ID
   * @param input - Event creation input
   * @returns Complete event history, sorted descending by timestamp
   * @throws Error if validation fails or database operation fails
   */
  async addItem(
    positionId: string,
    input: CreatePositionLedgerEventInput<P>
  ): Promise<PositionLedgerEvent<P>[]> {
    log.methodEntry(this.logger, 'addItem', {
      positionId,
      eventType: input.eventType,
      timestamp: input.timestamp,
    });

    try {
      // Validate event sequence
      await this.validateEventSequence(
        positionId,
        input.previousId,
        input.protocol
      );

      // Generate input hash
      const inputHash = this.generateInputHash(input);
      this.logger.debug({ positionId, inputHash }, 'Input hash generated');

      // Check if event already exists (deduplication by inputHash)
      const existingEvent = await this.prisma.positionLedgerEvent.findFirst({
        where: {
          positionId,
          inputHash,
        },
      });

      if (existingEvent) {
        this.logger.info(
          { positionId, inputHash, existingEventId: existingEvent.id },
          'Event already exists (duplicate inputHash), skipping insert'
        );
        log.methodExit(this.logger, 'addItem', { id: existingEvent.id, skipped: true });
        // Return complete history without inserting duplicate
        return this.findAllItems(positionId);
      }

      // Serialize config and state
      const configDB = this.serializeConfig(input.config);
      const stateDB = this.serializeState(input.state);

      // Serialize rewards
      const rewardsDB = input.rewards.map((r) => ({
        tokenId: r.tokenId,
        tokenAmount: r.tokenAmount.toString(),
        tokenValue: r.tokenValue.toString(),
      }));

      // Create event in database
      log.dbOperation(this.logger, 'create', 'PositionLedgerEvent', {
        positionId,
        eventType: input.eventType,
      });

      const result = await this.prisma.positionLedgerEvent.create({
        data: {
          positionId,
          protocol: input.protocol,
          previousId: input.previousId,
          timestamp: input.timestamp,
          eventType: input.eventType,
          inputHash,
          poolPrice: input.poolPrice.toString(),
          token0Amount: input.token0Amount.toString(),
          token1Amount: input.token1Amount.toString(),
          tokenValue: input.tokenValue.toString(),
          rewards: rewardsDB as object[],
          deltaCostBasis: input.deltaCostBasis.toString(),
          costBasisAfter: input.costBasisAfter.toString(),
          deltaPnl: input.deltaPnl.toString(),
          pnlAfter: input.pnlAfter.toString(),
          config: configDB as object,
          state: stateDB as object,
        },
      });

      this.logger.info(
        {
          id: result.id,
          positionId,
          eventType: input.eventType,
          timestamp: input.timestamp,
        },
        'Event created successfully'
      );

      log.methodExit(this.logger, 'addItem', { id: result.id });

      // Return complete history
      return this.findAllItems(positionId);
    } catch (error) {
      log.methodError(this.logger, 'addItem', error as Error, {
        positionId,
        eventType: input.eventType,
      });
      throw error;
    }
  }

  /**
   * Delete all events for a position
   *
   * This is typically used before rebuilding the ledger via discoverAllEvents.
   * Operation is idempotent - deleting for non-existent position returns silently.
   *
   * @param positionId - Position database ID
   */
  async deleteAllItems(positionId: string): Promise<void> {
    log.methodEntry(this.logger, 'deleteAllItems', { positionId });

    try {
      log.dbOperation(this.logger, 'deleteMany', 'PositionLedgerEvent', {
        positionId,
      });

      const result = await this.prisma.positionLedgerEvent.deleteMany({
        where: {
          positionId,
          protocol: String(this.constructor.name.toLowerCase().replace('positionledgerservice', '')),
        },
      });

      this.logger.info(
        {
          positionId,
          count: result.count,
        },
        'Events deleted successfully'
      );

      log.methodExit(this.logger, 'deleteAllItems', {
        positionId,
        count: result.count,
      });
    } catch (error) {
      log.methodError(this.logger, 'deleteAllItems', error as Error, {
        positionId,
      });
      throw error;
    }
  }
}
