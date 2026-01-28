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
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
  type UniswapV3Position,
} from '@midcurve/shared';
import type {
  UniswapV3PositionLedgerEventRow,
  UniswapV3LedgerEventConfig,
  UniswapV3LedgerEventState,
  EventType,
  Reward,
} from '@midcurve/shared';
import { getPositionManagerAddress } from '../../config/uniswapv3.js';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../pool/uniswapv3-pool-service.js';
import type { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';

// ============================================================================
// EVENT SIGNATURES
// ============================================================================

/**
 * Uniswap V3 NonfungiblePositionManager event signatures (topic0 values).
 *
 * These are keccak256 hashes of the event signatures:
 * - IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
 * - DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
 * - Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)
 */
export const UNISWAP_V3_POSITION_EVENT_SIGNATURES = {
  INCREASE_LIQUIDITY: '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
  DECREASE_LIQUIDITY: '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4',
  COLLECT: '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01',
} as const;

/**
 * Valid Uniswap V3 position event types that can be imported.
 */
export type ValidEventType = keyof typeof UNISWAP_V3_POSITION_EVENT_SIGNATURES;

// ============================================================================
// RAW LOG TYPES
// ============================================================================

/**
 * Raw log data from eth_getLogs or eth_subscribe.
 * Compatible with viem's Log type and raw RPC responses.
 */
export interface RawLogInput {
  /** Contract address that emitted the log */
  address: string;
  /** Indexed event topics */
  topics: readonly string[];
  /** Non-indexed event data */
  data: string;
  /** Block number (hex string or bigint) */
  blockNumber: string | bigint;
  /** Block hash (0x-prefixed) */
  blockHash: string;
  /** Transaction hash (0x-prefixed) */
  transactionHash: string;
  /** Transaction index within the block (hex string or number) */
  transactionIndex: string | number;
  /** Log index within the transaction (hex string or number) */
  logIndex: string | number;
  /** True if this log was removed due to a chain reorg */
  removed?: boolean;
}

/**
 * Result of validating a raw log event.
 */
export type ValidateRawEventResult =
  | { valid: true; eventType: ValidEventType }
  | {
      valid: false;
      reason:
        | 'unsupported_chain'
        | 'wrong_contract'
        | 'unknown_event'
        | 'wrong_nft_id'
        | 'missing_topics';
    };

/**
 * Aggregated position metrics after processing ledger event(s).
 * Values can be used to update the Position record.
 *
 * Note: Unclaimed fees are NOT included because they require on-chain calculation.
 * The caller can compute unclaimed fees using uncollectedPrincipal values and
 * the pool's fee growth data.
 */
export interface LedgerAggregates {
  /** Total liquidity after all events */
  liquidityAfter: bigint;

  /** Cost basis after all events (in quote token units) */
  costBasisAfter: bigint;

  /** Realized PnL after all events (in quote token units) */
  realizedPnlAfter: bigint;

  /** Total collected fees (in quote token units) */
  collectedFeesTotal: bigint;

  /** Uncollected principal in token0 (from decrease liquidity, awaiting collect) */
  uncollectedPrincipal0: bigint;
  /** Uncollected principal in token1 (from decrease liquidity, awaiting collect) */
  uncollectedPrincipal1: bigint;
}

/**
 * Result of importing a raw log event.
 */
export type ImportLogResult =
  | { action: 'inserted'; inputHash: string; aggregates: LedgerAggregates }
  | { action: 'removed'; inputHash: string; aggregates: LedgerAggregates }
  | { action: 'skipped'; reason: 'already_exists' | 'invalid_event' };

/**
 * Decoded data from a raw log's data field.
 */
export interface DecodedLogData {
  /** Liquidity delta (for INCREASE_LIQUIDITY and DECREASE_LIQUIDITY events) */
  liquidity?: bigint;
  /** Amount of token0 involved in the event */
  amount0: bigint;
  /** Amount of token1 involved in the event */
  amount1: bigint;
  /** Recipient address (for COLLECT events only) */
  recipient?: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates that a raw log event is a valid Uniswap V3 position event.
 *
 * Checks:
 * 1. The chainId is supported (via getPositionManagerAddress)
 * 2. The log was emitted from the correct NFPM contract for the chain
 * 3. The topic[0] matches IncreaseLiquidity, DecreaseLiquidity, or Collect
 * 4. The topic[1] matches the expected NFT token ID
 *
 * @param chainId - EVM chain ID
 * @param nftId - Expected NFT token ID (number, string, or bigint)
 * @param log - Raw log data to validate
 * @returns Validation result with event type if valid, or failure reason if invalid
 *
 * @example
 * ```typescript
 * const result = validateRawEvent(1, 12345, log);
 * if (result.valid) {
 *   console.log(`Valid ${result.eventType} event`);
 * } else {
 *   console.log(`Invalid: ${result.reason}`);
 * }
 * ```
 */
export function validateRawEvent(
  chainId: number,
  nftId: number | string | bigint,
  log: RawLogInput
): ValidateRawEventResult {
  // Check if chain is supported and get NFPM address
  let expectedAddress: string;
  try {
    expectedAddress = getPositionManagerAddress(chainId);
  } catch {
    return { valid: false, reason: 'unsupported_chain' };
  }

  // Check if log was emitted from the correct NFPM contract (case-insensitive)
  if (log.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { valid: false, reason: 'wrong_contract' };
  }

  // Check if we have enough topics
  if (!log.topics || log.topics.length < 2) {
    return { valid: false, reason: 'missing_topics' };
  }

  // Check topic[0] matches one of the valid event signatures
  const topic0 = log.topics[0]?.toLowerCase();
  let eventType: ValidEventType | null = null;

  for (const [type, signature] of Object.entries(UNISWAP_V3_POSITION_EVENT_SIGNATURES)) {
    if (topic0 === signature.toLowerCase()) {
      eventType = type as ValidEventType;
      break;
    }
  }

  if (!eventType) {
    return { valid: false, reason: 'unknown_event' };
  }

  // Check topic[1] matches the expected nftId
  // NFT ID is stored as a 32-byte (64 hex chars) padded value
  const expectedNftIdHex = '0x' + BigInt(nftId).toString(16).padStart(64, '0');
  const actualNftIdHex = log.topics[1]?.toLowerCase();

  if (actualNftIdHex !== expectedNftIdHex.toLowerCase()) {
    return { valid: false, reason: 'wrong_nft_id' };
  }

  return { valid: true, eventType };
}

/**
 * Decode the data field from a raw log based on event type.
 *
 * Event data layouts (ABI-encoded):
 * - INCREASE_LIQUIDITY: (uint128 liquidity, uint256 amount0, uint256 amount1)
 * - DECREASE_LIQUIDITY: (uint128 liquidity, uint256 amount0, uint256 amount1)
 * - COLLECT: (address recipient, uint256 amount0, uint256 amount1)
 *
 * @param eventType - The type of event
 * @param data - The hex-encoded data field from the log
 * @returns Decoded values based on event type
 */
export function decodeLogData(
  eventType: ValidEventType,
  data: string
): DecodedLogData {
  // Remove 0x prefix if present
  const hex = data.startsWith('0x') ? data.slice(2) : data;

  // Each ABI-encoded value is 32 bytes (64 hex chars)
  const chunks = hex.match(/.{64}/g) || [];

  if (chunks.length < 3) {
    throw new Error(`Invalid log data: expected at least 3 chunks, got ${chunks.length}`);
  }

  if (eventType === 'COLLECT') {
    // Collect: (address recipient, uint256 amount0, uint256 amount1)
    // Address is right-padded in 32 bytes, take last 40 chars (20 bytes)
    const recipientHex = chunks[0]!.slice(24); // Last 20 bytes
    return {
      recipient: '0x' + recipientHex,
      amount0: BigInt('0x' + chunks[1]!),
      amount1: BigInt('0x' + chunks[2]!),
    };
  } else {
    // IncreaseLiquidity/DecreaseLiquidity: (uint128 liquidity, uint256 amount0, uint256 amount1)
    return {
      liquidity: BigInt('0x' + chunks[0]!),
      amount0: BigInt('0x' + chunks[1]!),
      amount1: BigInt('0x' + chunks[2]!),
    };
  }
}

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

  /**
   * Find all events with a given transaction hash.
   *
   * Used for catch-up reorg detection: if we find events with the same txHash
   * but different blockHash, it indicates a reorg occurred while offline.
   *
   * @param txHash - Transaction hash to search for
   * @param tx - Optional transaction client
   * @returns Array of events with this txHash
   */
  async findByTxHash(
    txHash: string,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3PositionLedgerEvent[]> {
    const db = tx ?? this.prisma;
    const results = await db.positionLedgerEvent.findMany({
      where: {
        positionId: this.positionId,
        config: {
          path: ['txHash'],
          equals: txHash,
        },
      },
    });

    return results.map((result) =>
      UniswapV3PositionLedgerEvent.fromDB(
        result as unknown as UniswapV3PositionLedgerEventRow
      )
    );
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

  /**
   * Get the last (most recent) event for this position.
   *
   * Events are sorted by timestamp descending, so the first result is the most recent.
   *
   * @param tx - Optional transaction client
   * @returns The most recent event, or null if no events exist
   */
  async findLast(tx?: PrismaTransactionClient): Promise<UniswapV3PositionLedgerEvent | null> {
    const db = tx ?? this.prisma;
    const result = await db.positionLedgerEvent.findFirst({
      where: {
        positionId: this.positionId,
      },
      orderBy: [
        { timestamp: 'desc' },
      ],
    });

    if (!result) {
      return null;
    }

    return UniswapV3PositionLedgerEvent.fromDB(
      result as unknown as UniswapV3PositionLedgerEventRow
    );
  }

  /**
   * Recalculate aggregates from all events for this position.
   *
   * Used after reorgs to ensure consistency. Returns aggregates from
   * the last event, or zero values if no events exist.
   *
   * Note: unclaimedFees0/1 are returned as 0n since they require on-chain data.
   *
   * @param tx - Optional transaction client
   * @returns Aggregated metrics from all events
   */
  async recalculateAggregates(tx?: PrismaTransactionClient): Promise<LedgerAggregates> {
    const lastEvent = await this.findLast(tx);

    if (!lastEvent) {
      // No events - return zero aggregates
      return {
        liquidityAfter: 0n,
        costBasisAfter: 0n,
        realizedPnlAfter: 0n,
        collectedFeesTotal: 0n,
        uncollectedPrincipal0: 0n,
        uncollectedPrincipal1: 0n,
      };
    }

    // Get "after" values from the last event
    const config = lastEvent.typedConfig;

    // Calculate total collected fees by summing all COLLECT events
    const allEvents = await this.findAll(tx);
    let collectedFeesTotal = 0n;
    for (const event of allEvents) {
      // Sum up all rewards (fees are stored as rewards)
      for (const reward of event.rewards) {
        collectedFeesTotal += reward.tokenValue;
      }
    }

    return {
      liquidityAfter: config.liquidityAfter,
      costBasisAfter: lastEvent.costBasisAfter,
      realizedPnlAfter: lastEvent.pnlAfter,
      collectedFeesTotal,
      uncollectedPrincipal0: config.uncollectedPrincipal0After,
      uncollectedPrincipal1: config.uncollectedPrincipal1After,
    };
  }

  // ============================================================================
  // IMPORT METHODS
  // ============================================================================

  /**
   * Import a raw log event into the ledger database.
   *
   * Actions:
   * - If `removed=true`: Deletes events from the affected block, recalculates aggregates
   * - If event already exists: Returns 'skipped'
   * - Otherwise: Creates ledger event with calculated deltas/after values
   *
   * The pool price is fetched from the pool price service at the event's block number.
   * This ensures reorg-safe price lookups and proper timestamp extraction.
   *
   * @param position - UniswapV3Position (provides pool, tokens, isToken0Quote)
   * @param chainId - EVM chain ID
   * @param log - Raw log data from eth_getLogs or eth_subscribe
   * @param poolPriceService - Pool price service for discovering prices at specific blocks
   * @param tx - Optional Prisma transaction client
   * @returns Import result with aggregates (or skip reason)
   */
  async importLogForPosition(
    position: UniswapV3Position,
    chainId: number,
    log: RawLogInput,
    poolPriceService: UniswapV3PoolPriceService,
    tx?: PrismaTransactionClient
  ): Promise<ImportLogResult> {
    const nftId = position.typedConfig.nftId;

    // Validate the raw event
    const validation = validateRawEvent(chainId, nftId, log);
    if (validation.valid === false) {
      this.logger.debug(
        { positionId: this.positionId, reason: validation.reason },
        'Invalid event skipped'
      );
      return { action: 'skipped', reason: 'invalid_event' };
    }

    // Parse numeric fields from log
    const logIndex = typeof log.logIndex === 'string'
      ? parseInt(log.logIndex, log.logIndex.startsWith('0x') ? 16 : 10)
      : log.logIndex;

    const txIndex = typeof log.transactionIndex === 'string'
      ? parseInt(log.transactionIndex, log.transactionIndex.startsWith('0x') ? 16 : 10)
      : log.transactionIndex;

    const blockNumber = typeof log.blockNumber === 'string'
      ? BigInt(log.blockNumber)
      : log.blockNumber;

    // Compute the input hash for this event
    const inputHash = UniswapV3LedgerEventService.createHash(
      chainId,
      log.transactionHash,
      log.blockHash,
      logIndex
    );

    // Handle reorg case: remove all events from this block and recalculate
    if (log.removed) {
      const deletedCount = await this.deleteAllByBlockHash(log.blockHash, tx);
      if (deletedCount > 0) {
        this.logger.info({ blockHash: log.blockHash, deletedCount }, 'Events removed due to reorg');
      }
      const aggregates = await this.recalculateAggregates(tx);
      return { action: 'removed', inputHash, aggregates };
    }

    // Check if event already exists
    const existingId = await this.findIdByHash(inputHash, tx);
    if (existingId) {
      this.logger.debug({ inputHash }, 'Event already exists, skipping');
      return { action: 'skipped', reason: 'already_exists' };
    }

    // Check for catch-up reorg: same txHash but different blockHash
    // This happens when the indexer was offline during a reorg and is catching up
    // via eth_getLogs() - we may have stale events from an orphaned fork
    const eventsWithSameTxHash = await this.findByTxHash(log.transactionHash, tx);
    for (const existingEvent of eventsWithSameTxHash) {
      const existingBlockHash = existingEvent.typedConfig.blockHash;
      if (existingBlockHash !== log.blockHash) {
        // Reorg detected during catch-up - orphaned fork events found
        this.logger.info(
          {
            txHash: log.transactionHash,
            orphanedBlockHash: existingBlockHash,
            canonicalBlockHash: log.blockHash,
          },
          'Catch-up reorg detected: removing events from orphaned fork'
        );
        await this.deleteAllByBlockHash(existingBlockHash, tx);
        // Continue to insert the canonical event
        break;
      }
    }

    // Discover pool price at the event's block number
    // This is reorg-safe and provides both sqrtPriceX96 and timestamp
    const poolPrice = await poolPriceService.discover(
      position.pool.id,
      { blockNumber: Number(blockNumber) },
      tx
    );
    const sqrtPriceX96 = poolPrice.sqrtPriceX96;
    const blockTimestamp = poolPrice.timestamp;

    // Decode the log data
    const decoded = decodeLogData(validation.eventType, log.data);

    // Get previous event's "after" values (or zeros if first event)
    const previousEvent = await this.findLast(tx);
    const previousLiquidity = previousEvent?.typedConfig.liquidityAfter ?? 0n;
    const previousCostBasis = previousEvent?.costBasisAfter ?? 0n;
    const previousPnl = previousEvent?.pnlAfter ?? 0n;
    const previousUncollectedPrincipal0 = previousEvent?.typedConfig.uncollectedPrincipal0After ?? 0n;
    const previousUncollectedPrincipal1 = previousEvent?.typedConfig.uncollectedPrincipal1After ?? 0n;

    // Calculate deltas and "after" values based on event type
    let deltaL = 0n;
    let liquidityAfter = previousLiquidity;
    let deltaCostBasis = 0n;
    let costBasisAfter = previousCostBasis;
    let deltaPnl = 0n;
    let pnlAfter = previousPnl;
    let feesCollected0 = 0n;
    let feesCollected1 = 0n;
    let uncollectedPrincipal0After = previousUncollectedPrincipal0;
    let uncollectedPrincipal1After = previousUncollectedPrincipal1;

    // Calculate token value in quote tokens using shared utilities
    let tokenValue: bigint;
    if (position.isToken0Quote) {
      // token0 is quote, convert token1 to token0 units
      const amount1InQuote = valueOfToken1AmountInToken0(decoded.amount1, sqrtPriceX96);
      tokenValue = decoded.amount0 + amount1InQuote;
    } else {
      // token1 is quote, convert token0 to token1 units
      const amount0InQuote = valueOfToken0AmountInToken1(decoded.amount0, sqrtPriceX96);
      tokenValue = amount0InQuote + decoded.amount1;
    }

    // Map ValidEventType to EventType for database
    // Note: EventType uses INCREASE_POSITION/DECREASE_POSITION, not INCREASE_LIQUIDITY/DECREASE_LIQUIDITY
    const eventTypeMap: Record<ValidEventType, EventType> = {
      'INCREASE_LIQUIDITY': 'INCREASE_POSITION',
      'DECREASE_LIQUIDITY': 'DECREASE_POSITION',
      'COLLECT': 'COLLECT',
    };
    const eventType = eventTypeMap[validation.eventType];

    if (validation.eventType === 'INCREASE_LIQUIDITY') {
      // Adding liquidity - tokens are deposited into active liquidity
      deltaL = decoded.liquidity ?? 0n;
      liquidityAfter = previousLiquidity + deltaL;
      deltaCostBasis = tokenValue;
      costBasisAfter = previousCostBasis + deltaCostBasis;
      // No PnL realization on increase
      deltaPnl = 0n;
      pnlAfter = previousPnl;
      // Uncollected principal unchanged - tokens go into active liquidity, not owed amounts
      uncollectedPrincipal0After = previousUncollectedPrincipal0;
      uncollectedPrincipal1After = previousUncollectedPrincipal1;

    } else if (validation.eventType === 'DECREASE_LIQUIDITY') {
      // Removing liquidity - tokens become "owed" and must be collected via collect()
      deltaL = -(decoded.liquidity ?? 0n);
      liquidityAfter = previousLiquidity + deltaL;

      // Calculate proportional cost basis being removed
      let proportionalCostBasis = 0n;
      if (previousLiquidity > 0n && decoded.liquidity) {
        proportionalCostBasis = (decoded.liquidity * previousCostBasis) / previousLiquidity;
      }
      deltaCostBasis = -proportionalCostBasis;
      costBasisAfter = previousCostBasis + deltaCostBasis;

      // Realize PnL at decrease time: value of owed tokens vs proportional cost basis
      deltaPnl = tokenValue - proportionalCostBasis;
      pnlAfter = previousPnl + deltaPnl;

      // Uncollected principal INCREASES - withdrawn amounts are now owed
      uncollectedPrincipal0After = previousUncollectedPrincipal0 + decoded.amount0;
      uncollectedPrincipal1After = previousUncollectedPrincipal1 + decoded.amount1;

    } else if (validation.eventType === 'COLLECT') {
      // Collecting owed tokens (principal from decrease + accrued fees)
      deltaL = 0n;
      liquidityAfter = previousLiquidity;
      deltaCostBasis = 0n;
      costBasisAfter = previousCostBasis;

      // Determine how much of the collected amount is principal vs fees
      // Principal portion: min(collected, uncollectedPrincipal)
      const principal0Collected = decoded.amount0 <= previousUncollectedPrincipal0
        ? decoded.amount0
        : previousUncollectedPrincipal0;
      const principal1Collected = decoded.amount1 <= previousUncollectedPrincipal1
        ? decoded.amount1
        : previousUncollectedPrincipal1;

      // Fees are the remainder after principal
      feesCollected0 = decoded.amount0 - principal0Collected;
      feesCollected1 = decoded.amount1 - principal1Collected;

      // Calculate fee value in quote tokens for PnL
      let feeValue: bigint;
      if (position.isToken0Quote) {
        const fees1InQuote = valueOfToken1AmountInToken0(feesCollected1, sqrtPriceX96);
        feeValue = feesCollected0 + fees1InQuote;
      } else {
        const fees0InQuote = valueOfToken0AmountInToken1(feesCollected0, sqrtPriceX96);
        feeValue = fees0InQuote + feesCollected1;
      }

      // Only fees are realized gains (principal was already accounted for at decrease time)
      deltaPnl = feeValue;
      pnlAfter = previousPnl + deltaPnl;

      // Uncollected principal decreases by the principal portion collected
      uncollectedPrincipal0After = previousUncollectedPrincipal0 - principal0Collected;
      uncollectedPrincipal1After = previousUncollectedPrincipal1 - principal1Collected;
    }

    // Build the ledger event config
    const ledgerConfig: UniswapV3LedgerEventConfig = {
      chainId,
      nftId: BigInt(nftId),
      blockNumber,
      txIndex,
      logIndex,
      txHash: log.transactionHash,
      blockHash: log.blockHash,
      deltaL,
      liquidityAfter,
      feesCollected0,
      feesCollected1,
      uncollectedPrincipal0After,
      uncollectedPrincipal1After,
      sqrtPriceX96,
    };

    // Build the ledger event state (discriminated union based on event type)
    const tokenIdBigInt = BigInt(nftId);
    let ledgerState: UniswapV3LedgerEventState;
    if (validation.eventType === 'INCREASE_LIQUIDITY') {
      ledgerState = {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: tokenIdBigInt,
        liquidity: decoded.liquidity ?? 0n,
        amount0: decoded.amount0,
        amount1: decoded.amount1,
      };
    } else if (validation.eventType === 'DECREASE_LIQUIDITY') {
      ledgerState = {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: tokenIdBigInt,
        liquidity: decoded.liquidity ?? 0n,
        amount0: decoded.amount0,
        amount1: decoded.amount1,
      };
    } else {
      ledgerState = {
        eventType: 'COLLECT',
        tokenId: tokenIdBigInt,
        recipient: decoded.recipient ?? '',
        amount0: decoded.amount0,
        amount1: decoded.amount1,
      };
    }

    // Create the ledger event
    const createInput: CreateLedgerEventInput = {
      previousId: previousEvent?.id ?? null,
      timestamp: blockTimestamp,
      eventType,
      inputHash,
      poolPrice: sqrtPriceX96, // Store sqrtPriceX96 as pool price
      token0Amount: decoded.amount0,
      token1Amount: decoded.amount1,
      tokenValue,
      rewards: [], // Fees are tracked separately in config
      deltaCostBasis,
      costBasisAfter,
      deltaPnl,
      pnlAfter,
      config: ledgerConfig,
      state: ledgerState,
    };

    await this.create(createInput, tx);

    this.logger.debug(
      { inputHash, eventType: validation.eventType, liquidityAfter: liquidityAfter.toString() },
      'Ledger event created'
    );

    // Calculate total collected fees from all events
    const allEvents = await this.findAll(tx);
    let collectedFeesTotal = 0n;
    for (const event of allEvents) {
      for (const reward of event.rewards) {
        collectedFeesTotal += reward.tokenValue;
      }
      // Also add fees from COLLECT events
      if (event.eventType === 'COLLECT') {
        collectedFeesTotal += event.tokenValue;
      }
    }

    // Return aggregates
    const aggregates: LedgerAggregates = {
      liquidityAfter,
      costBasisAfter,
      realizedPnlAfter: pnlAfter,
      collectedFeesTotal,
      uncollectedPrincipal0: uncollectedPrincipal0After,
      uncollectedPrincipal1: uncollectedPrincipal1After,
    };

    return { action: 'inserted', inputHash, aggregates };
  }
}
