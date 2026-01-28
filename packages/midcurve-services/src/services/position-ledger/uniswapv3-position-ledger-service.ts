/**
 * Uniswap V3 Position Ledger Service
 *
 * Specialized service for Uniswap V3 position ledger event management.
 * Handles serialization/deserialization and discovery of position events from blockchain.
 *
 * Key features:
 * - Fetches events from Etherscan API
 * - Uses **historic pool prices** for accurate PnL calculations
 * - Calculates cost basis, realized PnL, and fee separation
 * - Maintains event chain with previousId linkage
 * - Idempotent discovery (same events won't be duplicated)
 */

import { createHash } from 'crypto';
import { PrismaClient } from '@midcurve/database';
import type {
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventState,
  PositionLedgerEventRow,
  EventType,
  Reward,
} from '@midcurve/shared';
import { UniswapV3PositionLedgerEvent, PositionLedgerEventFactory } from '@midcurve/shared';
import type {
  CreateUniswapV3LedgerEventInput,
  UniswapV3EventDiscoverInput,
} from '../types/position-ledger/position-ledger-event-input.js';
import {
  toEventConfig,
  toEventConfigDB,
  toEventState,
  toEventStateDB,
} from '../types/uniswapv3/position-ledger-event-db.js';
import { EtherscanClient } from '../../clients/etherscan/index.js';
import type { RawPositionEvent } from '../../clients/etherscan/types.js';
import { UniswapV3PositionService } from '../position/uniswapv3-position-service.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import type { UniswapV3Position } from '@midcurve/shared';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { Erc20Token } from '@midcurve/shared';
import type { UniswapV3PoolPrice } from '@midcurve/shared';
import {
  calculatePoolPriceInQuoteToken,
  calculateTokenValueInQuote,
  calculateProportionalCostBasis,
  separateFeesFromPrincipal,
} from '../../utils/uniswapv3/ledger-calculations.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { PositionAprService } from '../position-apr/position-apr-service.js';
import type { CreateAnyLedgerEventInput } from '../types/position-ledger/position-ledger-event-input.js';

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
 * Dependencies for UniswapV3PositionLedgerService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PositionLedgerServiceDependencies {
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

  /**
   * Etherscan client for fetching position events from blockchain
   * If not provided, the singleton EtherscanClient instance will be used
   */
  etherscanClient?: EtherscanClient;

  /**
   * Uniswap V3 position service for position data access
   * If not provided, a new UniswapV3PositionService instance will be created
   */
  positionService?: UniswapV3PositionService;

  /**
   * Uniswap V3 pool service for pool data access
   * If not provided, a new UniswapV3PoolService instance will be created
   */
  poolService?: UniswapV3PoolService;

  /**
   * Uniswap V3 pool price service for historic pool price discovery
   * If not provided, a new UniswapV3PoolPriceService instance will be created
   */
  poolPriceService?: UniswapV3PoolPriceService;
}

/**
 * Position data fetched from database
 */
interface PositionData {
  position: UniswapV3Position;
  nftId: bigint;
  chainId: number;
  poolId: string;
  isToken0Quote: boolean;
}

/**
 * Pool metadata with tokens
 */
interface PoolMetadata {
  pool: UniswapV3Pool;
  token0: Erc20Token;
  token1: Erc20Token;
  token0IsQuote: boolean;
  token0Decimals: number;
  token1Decimals: number;
}

/**
 * Historic pool price data
 */
interface HistoricPoolPrice {
  poolPrice: UniswapV3PoolPrice;
  sqrtPriceX96: bigint;
  timestamp: Date;
}

/**
 * Parameters for building event from raw data
 */
interface BuildEventParams {
  rawEvent: RawPositionEvent;
  previousState: PreviousEventState;
  poolMetadata: PoolMetadata;
  sqrtPriceX96: bigint;
  previousEventId: string | null;
  positionId: string;
}

/**
 * Previous event state for sequential building
 */
interface PreviousEventState {
  uncollectedPrincipal0: bigint;
  uncollectedPrincipal1: bigint;
  liquidity: bigint;
  costBasis: bigint;
  pnl: bigint;
}

/**
 * Uniswap V3 Position Ledger Service
 *
 * Standalone service for Uniswap V3 position ledger event management.
 * Fetches events from Etherscan and calculates financial data using historic pool prices.
 */
export class UniswapV3PositionLedgerService {
  protected readonly protocol = 'uniswapv3' as const;
  protected readonly _prisma: PrismaClient;
  protected readonly _aprService: PositionAprService;
  protected readonly logger: ServiceLogger;
  private readonly _etherscanClient: EtherscanClient;
  private readonly _positionService: UniswapV3PositionService;
  private readonly _poolService: UniswapV3PoolService;
  private readonly _poolPriceService: UniswapV3PoolPriceService;

  /**
   * Creates a new UniswapV3PositionLedgerService instance
   *
   * @param dependencies - Optional dependencies object
   */
  constructor(dependencies: UniswapV3PositionLedgerServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this._aprService = dependencies.aprService ?? new PositionAprService({ prisma: this._prisma });
    this.logger = createServiceLogger('UniswapV3PositionLedgerService');

    this._etherscanClient =
      dependencies.etherscanClient ?? EtherscanClient.getInstance();
    this._positionService =
      dependencies.positionService ??
      new UniswapV3PositionService({ prisma: this._prisma });
    this._poolService =
      dependencies.poolService ?? new UniswapV3PoolService({ prisma: this._prisma });
    this._poolPriceService =
      dependencies.poolPriceService ??
      new UniswapV3PoolPriceService({ prisma: this._prisma });

    this.logger.info('UniswapV3PositionLedgerService initialized');
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

  /**
   * Get the Etherscan client instance
   */
  protected get etherscanClient(): EtherscanClient {
    return this._etherscanClient;
  }

  /**
   * Get the position service instance
   */
  protected get positionService(): UniswapV3PositionService {
    return this._positionService;
  }

  /**
   * Get the pool service instance
   */
  protected get poolService(): UniswapV3PoolService {
    return this._poolService;
  }

  /**
   * Get the pool price service instance
   */
  protected get poolPriceService(): UniswapV3PoolPriceService {
    return this._poolPriceService;
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS - SERIALIZATION
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   *
   * Converts string values (bigint) to native bigint for Uniswap V3 config.
   *
   * @param configDB - Config object from database (JSON)
   * @returns Parsed config with native bigint values
   */
  parseConfig(configDB: unknown): UniswapV3LedgerEventConfig {
    return toEventConfig(configDB as any);
  }

  /**
   * Serialize config from application type to database JSON
   *
   * Converts native bigint values to strings for database storage.
   *
   * @param config - Application config with native bigint values
   * @returns Serialized config for database storage (JSON-serializable)
   */
  serializeConfig(config: UniswapV3LedgerEventConfig): unknown {
    return toEventConfigDB(config);
  }

  /**
   * Parse state from database JSON to application type
   *
   * Handles discriminated union (INCREASE/DECREASE/COLLECT) and converts
   * string values to bigint.
   *
   * @param stateDB - State object from database (JSON with string values)
   * @returns Parsed state with native bigint values
   */
  parseState(stateDB: unknown): UniswapV3LedgerEventState {
    return toEventState(stateDB as any);
  }

  /**
   * Serialize state from application type to database JSON
   *
   * Handles discriminated union serialization and converts bigint to strings.
   *
   * @param state - Application state with native bigint values
   * @returns Serialized state for database storage (JSON-serializable)
   */
  serializeState(state: UniswapV3LedgerEventState): unknown {
    return toEventStateDB(state);
  }

  // ============================================================================
  // PROTECTED HELPERS
  // ============================================================================

  /**
   * Map database result to UniswapV3PositionLedgerEvent using factory
   *
   * Converts string values to bigint for financial fields and uses
   * PositionLedgerEventFactory to create protocol-specific class.
   *
   * @param dbResult - Raw database result from Prisma
   * @returns UniswapV3PositionLedgerEvent instance
   */
  protected mapToLedgerEvent(
    dbResult: LedgerEventDbResult
  ): UniswapV3PositionLedgerEvent {
    // Parse rewards array
    const rewardsDB = dbResult.rewards as Array<{
      tokenId: string;
      tokenAmount: string;
      tokenValue: string;
    }>;

    const rewards: Reward[] = rewardsDB.map((r: { tokenId: string; tokenAmount: string; tokenValue: string }) => ({
      tokenId: r.tokenId,
      tokenAmount: BigInt(r.tokenAmount),
      tokenValue: BigInt(r.tokenValue),
    }));

    // Convert string bigint fields to native bigint
    const rowWithBigInt: PositionLedgerEventRow = {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      positionId: dbResult.positionId,
      protocol: dbResult.protocol,
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
      config: dbResult.config as Record<string, unknown>,
      state: dbResult.state as Record<string, unknown>,
    };

    // Use factory to create protocol-specific event class
    return PositionLedgerEventFactory.fromDB(rowWithBigInt) as UniswapV3PositionLedgerEvent;
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
  // HASH GENERATION
  // ============================================================================

  /**
   * Generate input hash for deduplication
   *
   * Creates MD5 hash from blockchain coordinates (blockNumber, txIndex, logIndex).
   * This ensures idempotent event processing - same event won't be added twice.
   *
   * @param input - Event creation input
   * @returns MD5 hash string (32 hex characters)
   */
  generateInputHash(input: CreateUniswapV3LedgerEventInput): string {
    const { blockNumber, txIndex, logIndex } = input.config;
    const hashInput = `${blockNumber}-${txIndex}-${logIndex}`;
    return createHash('md5').update(hashInput).digest('hex');
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS - DISCOVERY
  // ============================================================================

  /**
   * Discover all events for a position from blockchain
   *
   * Fetches complete event history from Etherscan and builds financial state sequentially.
   * Uses **historic pool prices** for each event to ensure accurate PnL calculations.
   *
   * Process:
   * 1. Fetch position data (nftId, chainId, poolId)
   * 2. Delete existing events (rebuild from scratch)
   * 3. Fetch pool metadata (tokens, decimals, etc.)
   * 4. Fetch raw events from Etherscan
   * 5. Deduplicate and sort chronologically
   * 6. For each event:
   *    - Discover historic pool price at event block
   *    - Calculate financial data (cost basis, PnL, fees)
   *    - Save event to database
   * 7. Return complete history (descending by timestamp)
   *
   * @param positionId - Position database ID
   * @returns Complete event history, sorted descending by timestamp (newest first)
   * @throws Error if position/pool not found or discovery fails
   */
  async discoverAllEvents(positionId: string): Promise<UniswapV3PositionLedgerEvent[]> {
    log.methodEntry(this.logger, 'discoverAllEvents', { positionId });

    try {
      // 1. Fetch position data
      const positionData = await this.fetchPositionData(positionId);
      const { nftId, chainId, poolId } = positionData;

      this.logger.info(
        { positionId, nftId, chainId, poolId },
        'Starting event discovery'
      );

      // 2. Delete existing events (rebuild from scratch)
      await this.deleteAllItems(positionId);

      // 3. Fetch pool metadata (pass position's quote token preference)
      const poolMetadata = await this.fetchPoolMetadata(poolId, positionData.isToken0Quote);

      // 4. Fetch raw events from Etherscan
      this.logger.info({ chainId, nftId }, 'Fetching events from Etherscan');
      const rawEvents = await this.etherscanClient.fetchPositionEvents(
        chainId,
        nftId.toString()
      );

      this.logger.info(
        { positionId, eventCount: rawEvents.length },
        'Raw events fetched from Etherscan'
      );

      if (rawEvents.length === 0) {
        this.logger.info({ positionId }, 'No events found for position');
        log.methodExit(this.logger, 'discoverAllEvents', { count: 0 });
        return [];
      }

      // 5. Deduplicate and sort chronologically
      const sortedEvents = this.sortEventsChronologically(rawEvents);

      // 6. Build state sequentially
      let previousState: PreviousEventState = {
        uncollectedPrincipal0: 0n,
        uncollectedPrincipal1: 0n,
        liquidity: 0n,
        costBasis: 0n,
        pnl: 0n,
      };
      let previousEventId: string | null = null;

      for (const rawEvent of sortedEvents) {
        this.logger.debug(
          {
            positionId,
            blockNumber: rawEvent.blockNumber,
            eventType: rawEvent.eventType,
          },
          'Processing event'
        );

        // Discover historic pool price at event block
        const historicPrice = await this.getHistoricPoolPrice(
          poolId,
          rawEvent.blockNumber
        );

        // Build event from raw data
        const eventInput = await this.buildEventFromRawData({
          rawEvent,
          previousState,
          poolMetadata,
          sqrtPriceX96: historicPrice.sqrtPriceX96,
          previousEventId,
          positionId,
        });

        // Save event
        const configDB = this.serializeConfig(eventInput.config) as Record<string, unknown>;
        const stateDB = this.serializeState(eventInput.state) as Record<string, unknown>;
        const savedEvents = await this.addItem(positionId, eventInput, configDB, stateDB);

        // Update state for next iteration
        previousEventId = savedEvents[0]!.id; // Newest event is first (descending order)
        previousState = {
          uncollectedPrincipal0: eventInput.config.uncollectedPrincipal0After,
          uncollectedPrincipal1: eventInput.config.uncollectedPrincipal1After,
          liquidity: eventInput.config.liquidityAfter,
          costBasis: eventInput.costBasisAfter,
          pnl: eventInput.pnlAfter,
        };

        this.logger.debug(
          {
            positionId,
            eventId: previousEventId,
            eventType: eventInput.eventType,
            costBasisAfter: eventInput.costBasisAfter.toString(),
            pnlAfter: eventInput.pnlAfter.toString(),
          },
          'Event processed and saved'
        );
      }

      // 7. Calculate APR periods from ledger events
      this.logger.info({ positionId }, 'Calculating APR periods');
      await this.aprService.refresh(positionId);

      // 8. Return complete history
      const allEvents = await this.findAllItems(positionId);

      this.logger.info(
        {
          positionId,
          eventCount: allEvents.length,
          finalCostBasis: previousState.costBasis.toString(),
          finalPnl: previousState.pnl.toString(),
        },
        'Event discovery completed'
      );

      log.methodExit(this.logger, 'discoverAllEvents', { count: allEvents.length });
      return allEvents;
    } catch (error) {
      log.methodError(this.logger, 'discoverAllEvents', error as Error, {
        positionId,
      });
      throw error;
    }
  }

  /**
   * Discover and add a single event to position ledger
   *
   * Adds a new event to the end of the event chain.
   * Validates event sequence and calculates financial data based on previous state.
   * Uses **historic pool price** at the event block for accurate calculations.
   *
   * Process:
   * 1. Fetch position data and validate NFT ID
   * 2. Fetch pool metadata
   * 3. Fetch last event (for previous state)
   * 4. Validate event timestamp is after last event
   * 5. Discover historic pool price at event block
   * 6. Calculate new state from previous + current event
   * 7. Save event
   * 8. Return complete history (descending by timestamp)
   *
   * @param positionId - Position database ID
   * @param input - Discovery input with raw event data
   * @returns Complete event history, sorted descending by timestamp (newest first)
   * @throws Error if event cannot be added or discovery fails
   */
  async discoverEvent(
    positionId: string,
    input: UniswapV3EventDiscoverInput
  ): Promise<UniswapV3PositionLedgerEvent[]> {
    log.methodEntry(this.logger, 'discoverEvent', {
      positionId,
      eventType: input.eventType,
      blockNumber: input.blockNumber,
    });

    try {
      // 1. Fetch position data and validate NFT ID
      const positionData = await this.fetchPositionData(positionId);
      const { nftId, poolId } = positionData;

      if (nftId !== input.tokenId) {
        const error = new Error(
          `NFT ID mismatch: position has ${nftId}, event has ${input.tokenId}`
        );
        log.methodError(this.logger, 'discoverEvent', error, {
          positionId,
          positionNftId: nftId,
          eventNftId: input.tokenId,
        });
        throw error;
      }

      // 2. Fetch pool metadata (pass position's quote token preference)
      const poolMetadata = await this.fetchPoolMetadata(poolId, positionData.isToken0Quote);

      // 3. Fetch last event (for previous state)
      const existingEvents = await this.findAllItems(positionId);
      const lastEvent = existingEvents[0]; // Newest first (descending order)

      // 4. Validate event timestamp is after last event
      if (lastEvent && input.timestamp <= lastEvent.timestamp) {
        const error = new Error(
          `Event timestamp (${input.timestamp.toISOString()}) must be after last event (${lastEvent.timestamp.toISOString()})`
        );
        log.methodError(this.logger, 'discoverEvent', error, {
          positionId,
          eventTimestamp: input.timestamp,
          lastEventTimestamp: lastEvent.timestamp,
        });
        throw error;
      }

      // Get previous state (use typedConfig for actual bigint values)
      const previousState: PreviousEventState = lastEvent
        ? {
            uncollectedPrincipal0: lastEvent.typedConfig.uncollectedPrincipal0After,
            uncollectedPrincipal1: lastEvent.typedConfig.uncollectedPrincipal1After,
            liquidity: lastEvent.typedConfig.liquidityAfter,
            costBasis: lastEvent.costBasisAfter,
            pnl: lastEvent.pnlAfter,
          }
        : {
            uncollectedPrincipal0: 0n,
            uncollectedPrincipal1: 0n,
            liquidity: 0n,
            costBasis: 0n,
            pnl: 0n,
          };

      const previousEventId = lastEvent?.id ?? null;

      // 5. Discover historic pool price at event block
      this.logger.info(
        { positionId, blockNumber: input.blockNumber },
        'Discovering historic pool price'
      );
      const historicPrice = await this.getHistoricPoolPrice(poolId, input.blockNumber);

      // 6. Convert discovery input to raw event format
      const rawEvent = this.convertDiscoverInputToRawEvent(input, positionData.chainId);

      // 7. Build event from raw data
      const eventInput = await this.buildEventFromRawData({
        rawEvent,
        previousState,
        poolMetadata,
        sqrtPriceX96: historicPrice.sqrtPriceX96,
        previousEventId,
        positionId,
      });

      // 8. Save event and refresh APR calculations
      const configDB = this.serializeConfig(eventInput.config) as Record<string, unknown>;
      const stateDB = this.serializeState(eventInput.state) as Record<string, unknown>;
      const allEvents = await this.addItem(positionId, eventInput, configDB, stateDB);

      this.logger.info(
        {
          positionId,
          eventId: allEvents[0]!.id,
          eventType: input.eventType,
          costBasisAfter: eventInput.costBasisAfter.toString(),
          pnlAfter: eventInput.pnlAfter.toString(),
        },
        'Single event discovered and saved'
      );

      // 9. Refresh APR periods
      this.logger.info({ positionId }, 'Refreshing APR periods');
      await this.aprService.refresh(positionId);

      log.methodExit(this.logger, 'discoverEvent', { count: allEvents.length });
      return allEvents as UniswapV3PositionLedgerEvent[];
    } catch (error) {
      log.methodError(this.logger, 'discoverEvent', error as Error, {
        positionId,
        eventType: input.eventType,
      });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Fetch position data from database
   *
   * @param positionId - Position ID
   * @returns Position data with extracted config fields
   * @throws Error if position not found or not uniswapv3
   */
  private async fetchPositionData(positionId: string): Promise<PositionData> {
    log.dbOperation(this.logger, 'findUnique', 'Position', { id: positionId });

    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      include: { pool: true },
    });

    if (!position) {
      throw new Error(`Position not found: ${positionId}`);
    }

    if (position.protocol !== 'uniswapv3') {
      throw new Error(
        `Invalid position protocol '${position.protocol}'. Expected 'uniswapv3'.`
      );
    }

    // Parse position config
    const config = position.config as unknown as { nftId: number; chainId: number };

    return {
      position: position as unknown as UniswapV3Position,
      nftId: BigInt(config.nftId),
      chainId: config.chainId,
      poolId: position.poolId,
      isToken0Quote: position.isToken0Quote,
    };
  }

  /**
   * Fetch pool metadata from database
   *
   * @param poolId - Pool ID
   * @param isToken0Quote - Whether token0 is the quote token (from position's user preference)
   * @returns Pool metadata with tokens and decimals
   * @throws Error if pool or tokens not found
   */
  private async fetchPoolMetadata(poolId: string, isToken0Quote: boolean): Promise<PoolMetadata> {
    log.dbOperation(this.logger, 'findUnique', 'Pool', { id: poolId });

    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
      include: {
        token0: true,
        token1: true,
      },
    });

    if (!pool) {
      throw new Error(`Pool not found: ${poolId}`);
    }

    if (!pool.token0 || !pool.token1) {
      throw new Error(`Pool tokens not found for pool: ${poolId}`);
    }

    return {
      pool: pool as unknown as UniswapV3Pool,
      token0: pool.token0 as unknown as Erc20Token,
      token1: pool.token1 as unknown as Erc20Token,
      token0IsQuote: isToken0Quote,
      token0Decimals: pool.token0.decimals,
      token1Decimals: pool.token1.decimals,
    };
  }

  // ============================================================================
  // USER-PROVIDED EVENT ADDITION
  // ============================================================================

  /**
   * Add events to position ledger from user-provided data
   *
   * This method allows users to manually add events to their position's ledger
   * after executing on-chain transactions. Events are validated for ordering,
   * processed with historic pool prices, and financial calculations are performed.
   *
   * Process:
   * 1. Fetch position and pool metadata
   * 2. Get existing ledger events and latest state
   * 3. Validate new events come AFTER existing events
   * 4. Sort new events by blockchain order
   * 5. Process each event sequentially:
   *    - Fetch historic pool price at blockNumber
   *    - Build ledger event with financial calculations
   *    - Add event to database
   *    - Update state for next event
   *
   * @param positionId - Position database ID
   * @param events - Array of user-provided events from transaction receipts
   * @throws Error if position not found, events out of order, or pool price fetch fails
   */
  async addEventsFromUserData(
    positionId: string,
    events: Array<{
      eventType: 'INCREASE_LIQUIDITY' | 'DECREASE_LIQUIDITY' | 'COLLECT';
      timestamp: Date;
      blockNumber: bigint;
      transactionIndex: number;
      logIndex: number;
      transactionHash: string;
      tokenId: bigint;
      liquidity?: bigint;
      amount0: bigint;
      amount1: bigint;
      recipient?: string;
    }>
  ): Promise<void> {
    log.methodEntry(this.logger, 'addEventsFromUserData', {
      positionId,
      eventCount: events.length,
    });

    try {
      // 1. Fetch position and pool metadata
      const positionData = await this.fetchPositionData(positionId);
      const { chainId, nftId, poolId } = positionData;

      this.logger.debug(
        { positionId, poolId, chainId, nftId },
        'Position data fetched'
      );

      const poolMetadata = await this.fetchPoolMetadata(poolId, positionData.isToken0Quote);

      this.logger.debug(
        {
          positionId,
          poolId,
          token0: poolMetadata.token0.symbol,
          token1: poolMetadata.token1.symbol,
          token0IsQuote: poolMetadata.token0IsQuote,
        },
        'Pool metadata fetched'
      );

      // 2. Get existing events and extract latest state
      const existingEvents = await this.findAllItems(positionId);

      this.logger.debug(
        { positionId, existingEventCount: existingEvents.length },
        'Existing events fetched'
      );

      // Sort existing events by blockchain order (ascending) for state calculation
      // Use typedConfig to get actual bigint values (not JSON-serialized strings)
      const sortedExisting = [...existingEvents].sort((a, b) => {
        const configA = a.typedConfig;
        const configB = b.typedConfig;
        if (configA.blockNumber !== configB.blockNumber) return Number(configA.blockNumber - configB.blockNumber);

        if (configA.txIndex !== configB.txIndex) return configA.txIndex - configB.txIndex;

        return configA.logIndex - configB.logIndex;
      });

      // Extract previous state from last event (or defaults if no events)
      let previousEventId: string | null = null;
      let lastBlockNumber = 0n;
      let lastTxIndex = 0;
      let lastLogIndex = 0;
      let liquidity = 0n;
      let costBasis = 0n;
      let pnl = 0n;
      let uncollectedPrincipal0 = 0n;
      let uncollectedPrincipal1 = 0n;

      if (sortedExisting.length > 0) {
        const lastEvent = sortedExisting[sortedExisting.length - 1];
        if (!lastEvent) {
          throw new Error('Expected last event but got undefined');
        }
        // Use typedConfig to get actual bigint values (not JSON-serialized strings)
        const lastEventConfig = lastEvent.typedConfig;
        previousEventId = lastEvent.id;
        lastBlockNumber = lastEventConfig.blockNumber;
        lastTxIndex = lastEventConfig.txIndex;
        lastLogIndex = lastEventConfig.logIndex;
        liquidity = lastEventConfig.liquidityAfter;
        costBasis = lastEvent.costBasisAfter;
        pnl = lastEvent.pnlAfter;
        uncollectedPrincipal0 = lastEventConfig.uncollectedPrincipal0After;
        uncollectedPrincipal1 = lastEventConfig.uncollectedPrincipal1After;

        this.logger.debug(
          {
            positionId,
            lastEventId: previousEventId,
            lastBlock: lastBlockNumber.toString(),
            lastTxIndex,
            lastLogIndex,
            liquidity: liquidity.toString(),
            costBasis: costBasis.toString(),
          },
          'Latest event state extracted'
        );
      } else {
        this.logger.debug(
          { positionId },
          'No existing events, starting fresh'
        );
      }

      // 3. Sort new events by blockchain order
      const sortedEvents = [...events].sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
        if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
        return a.logIndex - b.logIndex;
      });

      if (sortedEvents.length === 0) {
        this.logger.debug({ positionId }, 'No events to add');
        return;
      }

      const firstEvent = sortedEvents[0];
      const lastNewEvent = sortedEvents[sortedEvents.length - 1];
      if (!firstEvent || !lastNewEvent) {
        throw new Error('Expected events but got undefined');
      }

      this.logger.debug(
        {
          positionId,
          newEventCount: sortedEvents.length,
          firstBlock: firstEvent.blockNumber.toString(),
          lastBlock: lastNewEvent.blockNumber.toString(),
        },
        'New events sorted by blockchain order'
      );

      // 4. Validate event ordering - all new events must come AFTER existing events
      for (const event of sortedEvents) {
        // Check if event comes after last existing event
        if (event.blockNumber < lastBlockNumber) {
          const error = new Error(
            `Event at block ${event.blockNumber} comes before last existing event at block ${lastBlockNumber}`
          );
          log.methodError(this.logger, 'addEventsFromUserData', error, {
            positionId,
            eventBlock: event.blockNumber.toString(),
            lastBlock: lastBlockNumber.toString(),
          });
          throw error;
        }

        if (event.blockNumber === lastBlockNumber) {
          if (event.transactionIndex < lastTxIndex) {
            const error = new Error(
              `Event at tx index ${event.transactionIndex} comes before last existing event at tx index ${lastTxIndex} (same block ${lastBlockNumber})`
            );
            log.methodError(this.logger, 'addEventsFromUserData', error, {
              positionId,
              eventTxIndex: event.transactionIndex,
              lastTxIndex,
            });
            throw error;
          }

          if (event.transactionIndex === lastTxIndex) {
            if (event.logIndex <= lastLogIndex) {
              const error = new Error(
                `Event at log index ${event.logIndex} comes before or equals last existing event at log index ${lastLogIndex} (same block ${lastBlockNumber}, same tx ${lastTxIndex})`
              );
              log.methodError(this.logger, 'addEventsFromUserData', error, {
                positionId,
                eventLogIndex: event.logIndex,
                lastLogIndex,
              });
              throw error;
            }
          }
        }
      }

      this.logger.info(
        { positionId, eventCount: sortedEvents.length },
        'Event ordering validated - all events come after existing events'
      );

      // 5. Process events sequentially
      for (let i = 0; i < sortedEvents.length; i++) {
        const event = sortedEvents[i];
        if (!event) {
          throw new Error(`Expected event at index ${i} but got undefined`);
        }

        this.logger.debug(
          {
            positionId,
            eventIndex: i + 1,
            totalEvents: sortedEvents.length,
            eventType: event.eventType,
            blockNumber: event.blockNumber.toString(),
          },
          'Processing event'
        );

        // Fetch historic pool price at event blockNumber
        const historicPrice = await this.getHistoricPoolPrice(
          poolId,
          event.blockNumber
        );

        // Convert user event to RawPositionEvent format
        const rawEvent: RawPositionEvent = {
          eventType: event.eventType,
          tokenId: event.tokenId.toString(),
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          logIndex: event.logIndex,
          blockTimestamp: event.timestamp,
          chainId,
          liquidity: event.liquidity?.toString(),
          amount0: event.amount0.toString(),
          amount1: event.amount1.toString(),
          recipient: event.recipient,
        };

        // Build event input with financial calculations
        const eventInput = await this.buildEventFromRawData({
          rawEvent,
          previousState: {
            uncollectedPrincipal0,
            uncollectedPrincipal1,
            liquidity,
            costBasis,
            pnl,
          },
          poolMetadata,
          sqrtPriceX96: historicPrice.sqrtPriceX96,
          previousEventId,
          positionId,
        });

        this.logger.debug(
          {
            positionId,
            eventIndex: i + 1,
            eventType: eventInput.eventType,
            deltaCostBasis: eventInput.deltaCostBasis.toString(),
            deltaPnl: eventInput.deltaPnl.toString(),
          },
          'Event built with financial calculations'
        );

        // Add event to database
        const configDB = this.serializeConfig(eventInput.config) as Record<string, unknown>;
        const stateDB = this.serializeState(eventInput.state) as Record<string, unknown>;
        await this.addItem(positionId, eventInput, configDB, stateDB);

        // Update state for next iteration
        // Note: We get the actual event ID from the returned events
        const allEvents = await this.findAllItems(positionId);
        const justAdded = allEvents[0]; // Most recent (findAllItems returns descending)
        if (!justAdded) {
          throw new Error('Expected to find just-added event but got undefined');
        }
        previousEventId = justAdded.id;

        liquidity = eventInput.config.liquidityAfter;
        costBasis = eventInput.costBasisAfter;
        pnl = eventInput.pnlAfter;
        uncollectedPrincipal0 = eventInput.config.uncollectedPrincipal0After;
        uncollectedPrincipal1 = eventInput.config.uncollectedPrincipal1After;
        lastBlockNumber = event.blockNumber;
        lastTxIndex = event.transactionIndex;
        lastLogIndex = event.logIndex;

        this.logger.info(
          {
            positionId,
            eventIndex: i + 1,
            totalEvents: sortedEvents.length,
            liquidityAfter: liquidity.toString(),
            costBasisAfter: costBasis.toString(),
            pnlAfter: pnl.toString(),
          },
          'Event added successfully'
        );
      }

      log.methodExit(this.logger, 'addEventsFromUserData', {
        positionId,
        eventsAdded: sortedEvents.length,
      });
    } catch (error) {
      log.methodError(this.logger, 'addEventsFromUserData', error as Error, {
        positionId,
        eventCount: events.length,
      });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get historic pool price at specific block
   *
   * Uses pool price service to discover/fetch historic price.
   * The discover() method is idempotent - returns cached price if already exists.
   *
   * @param poolId - Pool ID
   * @param blockNumber - Block number for historic price
   * @returns Historic pool price data
   * @throws Error if price discovery fails
   */
  private async getHistoricPoolPrice(
    poolId: string,
    blockNumber: bigint
  ): Promise<HistoricPoolPrice> {
    this.logger.debug(
      { poolId, blockNumber: blockNumber.toString() },
      'Discovering historic pool price'
    );

    const poolPrice = await this.poolPriceService.discover(poolId, {
      blockNumber: Number(blockNumber),
    });

    const sqrtPriceX96 = poolPrice.state.sqrtPriceX96 as bigint;

    this.logger.debug(
      {
        poolId,
        blockNumber: blockNumber.toString(),
        sqrtPriceX96: sqrtPriceX96.toString(),
        timestamp: poolPrice.timestamp,
      },
      'Historic pool price discovered'
    );

    return {
      poolPrice,
      sqrtPriceX96,
      timestamp: poolPrice.timestamp,
    };
  }

  /**
   * Build event input from raw event data and calculated state
   *
   * Core financial calculation logic. Handles INCREASE/DECREASE/COLLECT events
   * and calculates cost basis, PnL, and fee separation.
   *
   * @param params - Build parameters
   * @returns Event creation input ready for database
   */
  private async buildEventFromRawData(
    params: BuildEventParams
  ): Promise<CreateUniswapV3LedgerEventInput> {
    const { rawEvent, previousState, poolMetadata, sqrtPriceX96, previousEventId, positionId } =
      params;

    const { token0, token1, token0IsQuote, token0Decimals, token1Decimals } = poolMetadata;

    // Calculate pool price from historic sqrtPriceX96
    const poolPrice = calculatePoolPriceInQuoteToken(
      sqrtPriceX96,
      token0IsQuote,
      token0Decimals,
      token1Decimals
    );

    // Parse amounts from raw event (strings to bigint)
    const amount0 = BigInt(rawEvent.amount0 ?? '0');
    const amount1 = BigInt(rawEvent.amount1 ?? '0');
    const tokenId = BigInt(rawEvent.tokenId);

    // Handle event type
    let deltaL = 0n;
    let liquidityAfter = previousState.liquidity;
    let deltaCostBasis = 0n;
    let costBasisAfter = previousState.costBasis;
    let deltaPnl = 0n;
    let pnlAfter = previousState.pnl;
    let feesCollected0 = 0n;
    let feesCollected1 = 0n;
    let uncollectedPrincipal0After = previousState.uncollectedPrincipal0;
    let uncollectedPrincipal1After = previousState.uncollectedPrincipal1;
    let rewards: Array<{ tokenId: string; tokenAmount: bigint; tokenValue: bigint }> = [];
    let state: UniswapV3LedgerEventState;

    if (rawEvent.eventType === 'INCREASE_LIQUIDITY') {
      // INCREASE_LIQUIDITY: Add liquidity and increase cost basis
      deltaL = BigInt(rawEvent.liquidity ?? '0');
      liquidityAfter = previousState.liquidity + deltaL;

      const tokenValue = calculateTokenValueInQuote(
        amount0,
        amount1,
        sqrtPriceX96,
        token0IsQuote,
        token0Decimals,
        token1Decimals
      );

      deltaCostBasis = tokenValue;
      costBasisAfter = previousState.costBasis + tokenValue;

      // No PnL realization on deposit
      deltaPnl = 0n;
      pnlAfter = previousState.pnl;

      state = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId,
        liquidity: deltaL,
        amount0,
        amount1,
      };
    } else if (rawEvent.eventType === 'DECREASE_LIQUIDITY') {
      // DECREASE_LIQUIDITY: Remove liquidity, realize PnL, add to uncollected principal
      deltaL = BigInt(rawEvent.liquidity ?? '0');
      liquidityAfter = previousState.liquidity - deltaL;

      // Calculate proportional cost basis removal
      const proportionalCostBasis = calculateProportionalCostBasis(
        previousState.costBasis,
        deltaL,
        previousState.liquidity
      );

      deltaCostBasis = -proportionalCostBasis;
      costBasisAfter = previousState.costBasis - proportionalCostBasis;

      // Calculate token value at current (historic) price
      const tokenValue = calculateTokenValueInQuote(
        amount0,
        amount1,
        sqrtPriceX96,
        token0IsQuote,
        token0Decimals,
        token1Decimals
      );

      // Realize PnL = value received - cost basis removed
      deltaPnl = tokenValue - proportionalCostBasis;
      pnlAfter = previousState.pnl + deltaPnl;

      // Add withdrawn amounts to uncollected principal pool
      uncollectedPrincipal0After = previousState.uncollectedPrincipal0 + amount0;
      uncollectedPrincipal1After = previousState.uncollectedPrincipal1 + amount1;

      state = {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId,
        liquidity: deltaL,
        amount0,
        amount1,
      };
    } else {
      // COLLECT: Separate fees from principal, no PnL change
      const { feeAmount0, feeAmount1, principalAmount0, principalAmount1 } = separateFeesFromPrincipal(
        amount0,
        amount1,
        previousState.uncollectedPrincipal0,
        previousState.uncollectedPrincipal1
      );

      feesCollected0 = feeAmount0;
      feesCollected1 = feeAmount1;

      uncollectedPrincipal0After = previousState.uncollectedPrincipal0 - principalAmount0;
      uncollectedPrincipal1After = previousState.uncollectedPrincipal1 - principalAmount1;

      // Calculate fee values
      const fee0Value = calculateTokenValueInQuote(
        feeAmount0,
        0n,
        sqrtPriceX96,
        token0IsQuote,
        token0Decimals,
        token1Decimals
      );
      const fee1Value = calculateTokenValueInQuote(
        0n,
        feeAmount1,
        sqrtPriceX96,
        token0IsQuote,
        token0Decimals,
        token1Decimals
      );

      // Build rewards array (only include non-zero fees)
      if (feeAmount0 > 0n) {
        rewards.push({
          tokenId: token0.id,
          tokenAmount: feeAmount0,
          tokenValue: fee0Value,
        });
      }
      if (feeAmount1 > 0n) {
        rewards.push({
          tokenId: token1.id,
          tokenAmount: feeAmount1,
          tokenValue: fee1Value,
        });
      }

      // No cost basis or PnL change on collect
      deltaCostBasis = 0n;
      costBasisAfter = previousState.costBasis;
      deltaPnl = 0n;
      pnlAfter = previousState.pnl;

      state = {
        eventType: 'COLLECT',
        tokenId,
        recipient: rawEvent.recipient ?? '0x0000000000000000000000000000000000000000',
        amount0,
        amount1,
      };
    }

    // Calculate total token value (for display)
    const tokenValue = calculateTokenValueInQuote(
      amount0,
      amount1,
      sqrtPriceX96,
      token0IsQuote,
      token0Decimals,
      token1Decimals
    );

    // Map blockchain event type to ledger event type
    let ledgerEventType: 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT';
    if (rawEvent.eventType === 'INCREASE_LIQUIDITY') {
      ledgerEventType = 'INCREASE_POSITION';
    } else if (rawEvent.eventType === 'DECREASE_LIQUIDITY') {
      ledgerEventType = 'DECREASE_POSITION';
    } else {
      ledgerEventType = 'COLLECT';
    }

    // Build event input (without inputHash - will be generated by base service)
    const eventInput: Omit<CreateUniswapV3LedgerEventInput, 'inputHash'> = {
      positionId,
      protocol: 'uniswapv3',
      previousId: previousEventId,
      timestamp: rawEvent.blockTimestamp,
      eventType: ledgerEventType,
      poolPrice,
      token0Amount: amount0,
      token1Amount: amount1,
      tokenValue,
      rewards,
      deltaCostBasis,
      costBasisAfter,
      deltaPnl,
      pnlAfter,
      config: {
        chainId: rawEvent.chainId,
        nftId: BigInt(rawEvent.tokenId),
        blockNumber: rawEvent.blockNumber,
        txIndex: rawEvent.transactionIndex,
        logIndex: rawEvent.logIndex,
        txHash: rawEvent.transactionHash,
        deltaL,
        liquidityAfter,
        feesCollected0,
        feesCollected1,
        uncollectedPrincipal0After,
        uncollectedPrincipal1After,
        sqrtPriceX96,
      },
      state,
    };

    // Generate input hash using config coordinates
    const inputHash = this.generateInputHash(eventInput as CreateUniswapV3LedgerEventInput);

    return {
      ...eventInput,
      inputHash,
    };
  }

  /**
   * Convert discovery input to raw event format
   *
   * @param input - Discovery input
   * @param chainId - Chain ID from position
   * @returns Raw event format for internal processing
   */
  private convertDiscoverInputToRawEvent(
    input: UniswapV3EventDiscoverInput,
    chainId: number
  ): RawPositionEvent {
    return {
      eventType: input.eventType,
      tokenId: input.tokenId.toString(),
      transactionHash: input.transactionHash,
      blockNumber: input.blockNumber,
      transactionIndex: input.transactionIndex,
      logIndex: input.logIndex,
      blockTimestamp: input.timestamp,
      chainId,
      liquidity: input.liquidity?.toString(),
      amount0: input.amount0.toString(),
      amount1: input.amount1.toString(),
      recipient: input.recipient,
    };
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

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
  ): Promise<UniswapV3PositionLedgerEvent | null> {
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
    input: CreateAnyLedgerEventInput,
    configDB: Record<string, unknown>,
    stateDB: Record<string, unknown>
  ): Promise<UniswapV3PositionLedgerEvent[]> {
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
      const inputHash = this.generateInputHash(input as CreateUniswapV3LedgerEventInput);
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
          protocol: 'uniswapv3',
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

  /**
   * Find all events for a position using blockchain ordering
   *
   * This ensures deterministic event ordering based on blockchain coordinates
   * (blockNumber, txIndex, logIndex) stored in the config field, rather than
   * relying on database timestamps which can have collisions for events in the same block.
   *
   * @param positionId - Position database ID
   * @returns Array of events, sorted descending by blockchain coordinates (newest first)
   */
  async findAllItems(positionId: string): Promise<UniswapV3PositionLedgerEvent[]> {
    log.methodEntry(this.logger, 'findAllItems (Uniswap V3 override)', { positionId });

    try {
      log.dbOperation(this.logger, 'findMany', 'PositionLedgerEvent', {
        positionId,
      });

      // Fetch all events without ordering (we'll sort in-memory)
      const results = await this.prisma.positionLedgerEvent.findMany({
        where: {
          positionId,
          protocol: 'uniswapv3',
        },
      });

      // Map to typed events (cast to concrete type since all events in this service are UniswapV3)
      const events = results.map((r) =>
        this.mapToLedgerEvent(r as LedgerEventDbResult) as UniswapV3PositionLedgerEvent
      );

      // Sort by blockchain coordinates (descending - newest first)
      // Use typedConfig to get actual bigint values (not JSON-serialized strings)
      events.sort((a, b) => {
        const configA = a.typedConfig;
        const configB = b.typedConfig;

        // Compare block numbers (descending)
        if (configA.blockNumber > configB.blockNumber) return -1;
        if (configA.blockNumber < configB.blockNumber) return 1;

        // Same block: compare transaction index (descending)
        if (configA.txIndex > configB.txIndex) return -1;
        if (configA.txIndex < configB.txIndex) return 1;

        // Same transaction: compare log index (descending)
        if (configA.logIndex > configB.logIndex) return -1;
        if (configA.logIndex < configB.logIndex) return 1;

        return 0;
      });

      this.logger.debug(
        {
          positionId,
          count: events.length,
        },
        'Events retrieved and sorted by blockchain coordinates'
      );

      log.methodExit(this.logger, 'findAllItems', {
        positionId,
        count: events.length,
      });
      return events as UniswapV3PositionLedgerEvent[];
    } catch (error) {
      log.methodError(this.logger, 'findAllItems', error as Error, {
        positionId,
      });
      throw error;
    }
  }

  /**
   * Sort events chronologically
   *
   * Sorts by blockNumber ASC → transactionIndex ASC → logIndex ASC.
   * This ensures correct processing order for sequential state building.
   *
   * @param events - Unsorted events
   * @returns Sorted events (oldest first)
   */
  private sortEventsChronologically(events: RawPositionEvent[]): RawPositionEvent[] {
    return [...events].sort((a, b) => {
      // Compare block numbers
      if (a.blockNumber < b.blockNumber) return -1;
      if (a.blockNumber > b.blockNumber) return 1;

      // Same block: compare transaction index
      if (a.transactionIndex < b.transactionIndex) return -1;
      if (a.transactionIndex > b.transactionIndex) return 1;

      // Same transaction: compare log index
      if (a.logIndex < b.logIndex) return -1;
      if (a.logIndex > b.logIndex) return 1;

      return 0;
    });
  }
}
