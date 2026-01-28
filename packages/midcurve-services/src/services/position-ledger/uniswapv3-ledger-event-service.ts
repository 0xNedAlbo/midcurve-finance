/**
 * UniswapV3LedgerEventService
 *
 * Service for managing Uniswap V3 position ledger events.
 * Handles event creation, retrieval, and deduplication with reorg-safe hashing.
 */

import { PrismaClient } from '@midcurve/database';
import {
  UniswapV3PositionLedgerEvent,
  ledgerEventConfigToJSON,
  ledgerEventStateToJSON,
} from '@midcurve/shared';
import type {
  UniswapV3PositionLedgerEventRow,
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventState,
  EventType,
  Reward,
} from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Prisma transaction client type for use in transactional operations.
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ============================================================================
// DEPENDENCIES
// ============================================================================

/**
 * Dependencies for UniswapV3LedgerEventService.
 * All dependencies are optional and will use defaults if not provided.
 */
export interface UniswapV3LedgerEventServiceDependencies {
  /**
   * Prisma client for database operations.
   * If not provided, a new PrismaClient instance will be created.
   */
  prisma?: PrismaClient;
}

/**
 * Configuration for UniswapV3LedgerEventService.
 */
export interface UniswapV3LedgerEventServiceConfig {
  /**
   * Position ID that this service instance operates on.
   * All methods will use this position ID.
   */
  positionId: string;
}

/**
 * Input for creating a new ledger event.
 */
export interface CreateLedgerEventInput {
  /** Event chaining - ID of the previous event */
  previousId: string | null;
  /** Block timestamp */
  timestamp: Date;
  /** Event type */
  eventType: EventType;
  /** Unique input hash for deduplication */
  inputHash: string;
  /** Pool price at event time (in quote token units per base token) */
  poolPrice: bigint;
  /** Amount of token0 involved */
  token0Amount: bigint;
  /** Amount of token1 involved */
  token1Amount: bigint;
  /** Total value in quote token units */
  tokenValue: bigint;
  /** Rewards/fees collected */
  rewards: Reward[];
  /** Change in cost basis */
  deltaCostBasis: bigint;
  /** Cost basis after this event */
  costBasisAfter: bigint;
  /** Change in PnL */
  deltaPnl: bigint;
  /** PnL after this event */
  pnlAfter: bigint;
  /** Protocol-specific config */
  config: UniswapV3LedgerEventConfig;
  /** Protocol-specific state */
  state: UniswapV3LedgerEventState;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * UniswapV3LedgerEventService
 *
 * Manages position ledger events for a specific Uniswap V3 position.
 * Provides reorg-safe event identification using txHash/blockHash/logIndex.
 *
 * Each instance is scoped to a single position via the positionId parameter.
 */
export class UniswapV3LedgerEventService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  public readonly protocol = 'uniswapv3' as const;
  public readonly positionId: string;

  /**
   * Creates a new UniswapV3LedgerEventService instance for a specific position.
   *
   * @param config - Configuration object containing the positionId
   * @param config.positionId - Position ID that this service instance operates on
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(
    config: UniswapV3LedgerEventServiceConfig,
    dependencies: UniswapV3LedgerEventServiceDependencies = {}
  ) {
    this.positionId = config.positionId;
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('UniswapV3LedgerEventService');
  }

  /**
   * Get the Prisma client instance.
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // HASH METHODS
  // ============================================================================

  /**
   * Creates a reorg-safe input hash from event coordinates.
   *
   * The hash is a composite string that uniquely identifies an event on the blockchain.
   * Uses txHash and blockHash (instead of blockNumber/txIndex) for reorg safety -
   * if a reorg occurs, the blockHash changes, invalidating any stale cached data.
   *
   * Format: "uniswapv3/{chainId}/{txHash}/{blockHash}/{logIndex}"
   *
   * @param chainId - EVM chain ID
   * @param txHash - Transaction hash (0x-prefixed hex string)
   * @param blockHash - Block hash (0x-prefixed hex string)
   * @param logIndex - Log index within the transaction
   * @returns Composite string identifier for the event
   *
   * @example
   * ```typescript
   * const hash = UniswapV3LedgerEventService.createHash(
   *   1,
   *   '0xabc123...',
   *   '0xdef456...',
   *   3
   * );
   * // Returns: "uniswapv3/1/0xabc123.../0xdef456.../3"
   * ```
   */
  static createHash(chainId: number, txHash: string, blockHash: string, logIndex: number): string {
    return `uniswapv3/${chainId}/${txHash}/${blockHash}/${logIndex}`;
  }

  /**
   * Creates a reorg-safe input hash from event config.
   *
   * Instance method that delegates to the static createHash method.
   * Accepts a config object containing the required hash components.
   *
   * @param config - Object containing chainId, txHash, blockHash, and logIndex
   * @returns Composite string identifier for the event
   *
   * @example
   * ```typescript
   * const service = new UniswapV3LedgerEventService();
   * const hash = service.createHashForEvent({
   *   chainId: 1,
   *   txHash: '0xabc123...',
   *   blockHash: '0xdef456...',
   *   logIndex: 3,
   * });
   * ```
   */
  createHashForEvent(config: {
    chainId: number;
    txHash: string;
    blockHash: string;
    logIndex: number;
  }): string {
    return UniswapV3LedgerEventService.createHash(
      config.chainId,
      config.txHash,
      config.blockHash,
      config.logIndex
    );
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Find an event's database ID by its input hash.
   *
   * Useful for checking if an event already exists before creating it.
   *
   * @param inputHash - The input hash to search for
   * @param tx - Optional transaction client
   * @returns The database ID if found, null otherwise
   */
  async findIdByHash(inputHash: string, tx?: PrismaTransactionClient): Promise<string | null> {
    const db = tx ?? this.prisma;
    const result = await db.positionLedgerEvent.findFirst({
      where: {
        positionId: this.positionId,
        inputHash,
      },
      select: {
        id: true,
      },
    });

    return result?.id ?? null;
  }

  // ============================================================================
  // CRUD METHODS
  // ============================================================================

  /**
   * Find an event by its database ID.
   *
   * @param id - Database ID of the event
   * @param tx - Optional transaction client
   * @returns The event if found, null otherwise
   */
  async findById(id: string, tx?: PrismaTransactionClient): Promise<UniswapV3PositionLedgerEvent | null> {
    const db = tx ?? this.prisma;
    const result = await db.positionLedgerEvent.findFirst({
      where: {
        id,
        positionId: this.positionId,
      },
    });

    if (!result) {
      return null;
    }

    return UniswapV3PositionLedgerEvent.fromDB(
      result as unknown as UniswapV3PositionLedgerEventRow
    );
  }

  /**
   * Find all events for this position.
   *
   * Events are returned sorted by blockchain coordinates (newest first):
   * blockNumber DESC, txIndex DESC, logIndex DESC
   *
   * @param tx - Optional transaction client
   * @returns Array of events for this position
   */
  async findAll(tx?: PrismaTransactionClient): Promise<UniswapV3PositionLedgerEvent[]> {
    const db = tx ?? this.prisma;
    const results = await db.positionLedgerEvent.findMany({
      where: {
        positionId: this.positionId,
      },
      orderBy: [
        { timestamp: 'desc' },
      ],
    });

    return results.map((result) =>
      UniswapV3PositionLedgerEvent.fromDB(
        result as unknown as UniswapV3PositionLedgerEventRow
      )
    );
  }

  /**
   * Create a new ledger event.
   *
   * @param input - Event data to create
   * @param tx - Optional transaction client
   * @returns The created event
   */
  async create(input: CreateLedgerEventInput, tx?: PrismaTransactionClient): Promise<UniswapV3PositionLedgerEvent> {
    const db = tx ?? this.prisma;
    const result = await db.positionLedgerEvent.create({
      data: {
        positionId: this.positionId,
        protocol: this.protocol,
        previousId: input.previousId,
        timestamp: input.timestamp,
        eventType: input.eventType,
        inputHash: input.inputHash,
        poolPrice: input.poolPrice.toString(),
        token0Amount: input.token0Amount.toString(),
        token1Amount: input.token1Amount.toString(),
        tokenValue: input.tokenValue.toString(),
        rewards: input.rewards.map((r) => ({
          tokenId: r.tokenId,
          tokenAmount: r.tokenAmount.toString(),
          tokenValue: r.tokenValue.toString(),
        })),
        deltaCostBasis: input.deltaCostBasis.toString(),
        costBasisAfter: input.costBasisAfter.toString(),
        deltaPnl: input.deltaPnl.toString(),
        pnlAfter: input.pnlAfter.toString(),
        config: ledgerEventConfigToJSON(input.config) as object,
        state: ledgerEventStateToJSON(input.state) as object,
      },
    });

    return UniswapV3PositionLedgerEvent.fromDB(
      result as unknown as UniswapV3PositionLedgerEventRow
    );
  }

  /**
   * Delete an event by its database ID.
   *
   * @param id - Database ID of the event to delete
   * @param tx - Optional transaction client
   * @returns true if deleted, false if not found
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<boolean> {
    const db = tx ?? this.prisma;
    try {
      await db.positionLedgerEvent.delete({
        where: {
          id,
          positionId: this.positionId,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all events for this position.
   *
   * @param tx - Optional transaction client
   * @returns Number of events deleted
   */
  async deleteAll(tx?: PrismaTransactionClient): Promise<number> {
    const db = tx ?? this.prisma;
    const result = await db.positionLedgerEvent.deleteMany({
      where: {
        positionId: this.positionId,
      },
    });
    return result.count;
  }

  /**
   * Delete all events with a specific block hash.
   *
   * Useful for handling chain reorgs - when a reorg is detected,
   * delete all events from the affected block(s) by their blockHash.
   *
   * @param blockHash - Block hash to match (0x-prefixed hex string)
   * @param tx - Optional transaction client
   * @returns Number of events deleted
   */
  async deleteAllByBlockHash(blockHash: string, tx?: PrismaTransactionClient): Promise<number> {
    const db = tx ?? this.prisma;
    const result = await db.positionLedgerEvent.deleteMany({
      where: {
        positionId: this.positionId,
        config: {
          path: ['blockHash'],
          equals: blockHash,
        },
      },
    });
    return result.count;
  }
}
