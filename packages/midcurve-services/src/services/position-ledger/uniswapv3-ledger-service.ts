/**
 * UniswapV3LedgerService
 *
 * Service for managing Uniswap V3 position ledger events.
 * Handles event creation, retrieval, and deduplication with reorg-safe hashing.
 */

import { prisma as prismaClient, PrismaClient } from "@midcurve/database";
import {
    UniswapV3PositionLedgerEvent,
    ledgerEventConfigToJSON,
    ledgerEventStateToJSON,
    valueOfToken0AmountInToken1,
    valueOfToken1AmountInToken0,
    type UniswapV3Position,
} from "@midcurve/shared";
import type {
    UniswapV3PositionLedgerEventRow,
    UniswapV3LedgerEventConfig,
    UniswapV3LedgerEventState,
    EventType,
    Reward,
} from "@midcurve/shared";
import { getPositionManagerAddress } from "../../config/uniswapv3.js";
import { createServiceLogger } from "../../logging/index.js";
import type { ServiceLogger } from "../../logging/index.js";
import type { PrismaTransactionClient } from "../../clients/prisma/index.js";
import type { UniswapV3PoolPriceService } from "../pool-price/uniswapv3-pool-price-service.js";
import {
    calculateAprBps,
    calculateDurationSeconds,
    calculateTimeWeightedCostBasis,
} from "../../utils/apr/apr-calculations.js";
import { UniswapV3AprService } from "../position-apr/uniswapv3-apr-service.js";
import type { AprPeriodData } from "../types/position-apr/index.js";

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
    INCREASE_LIQUIDITY:
        "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f",
    DECREASE_LIQUIDITY:
        "0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4",
    COLLECT:
        "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01",
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
              | "unsupported_chain"
              | "wrong_contract"
              | "unknown_event"
              | "wrong_nft_id"
              | "missing_topics";
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
    collectedFeesAfter: bigint;

    /** Total realized cashflow after all events (in quote token units) - always 0 for AMM positions */
    realizedCashflowAfter: bigint;

    /** Uncollected principal in token0 (from decrease liquidity, awaiting collect) */
    uncollectedPrincipal0: bigint;
    /** Uncollected principal in token1 (from decrease liquidity, awaiting collect) */
    uncollectedPrincipal1: bigint;
}

// AprPeriodData is imported from types/position-apr

/**
 * Result for a single log import within a batch.
 * Does not include aggregates - those are calculated once at the end of the batch.
 */
export type SingleLogResult =
    | {
          action: "inserted";
          inputHash: string;
          eventDetail: {
              validEventType: ValidEventType;
              amount0: bigint;
              amount1: bigint;
              liquidityDelta: bigint;
              tokenValue: bigint;
              blockTimestamp: Date;
          };
      }
    | { action: "removed"; inputHash: string; deletedCount: number; blockHash: string }
    | { action: "skipped"; reason: "already_exists" | "invalid_event" };

/**
 * Result of importing multiple raw log events.
 * Contains per-log results and final aggregates after all events are processed.
 * APR periods are persisted internally by the ledger service during import.
 */
export interface ImportLogsResult {
    /** Results for each input log */
    results: SingleLogResult[];
    /** Aggregates before any logs in this batch were imported */
    preImportAggregates: LedgerAggregates;
    /** Final aggregates after recalculating all events in correct order */
    aggregates: LedgerAggregates;
}

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
    log: RawLogInput,
): ValidateRawEventResult {
    // Check if chain is supported and get NFPM address
    let expectedAddress: string;
    try {
        expectedAddress = getPositionManagerAddress(chainId);
    } catch {
        return { valid: false, reason: "unsupported_chain" };
    }

    // Check if log was emitted from the correct NFPM contract (case-insensitive)
    if (log.address.toLowerCase() !== expectedAddress.toLowerCase()) {
        return { valid: false, reason: "wrong_contract" };
    }

    // Check if we have enough topics
    if (!log.topics || log.topics.length < 2) {
        return { valid: false, reason: "missing_topics" };
    }

    // Check topic[0] matches one of the valid event signatures
    const topic0 = log.topics[0]?.toLowerCase();
    let eventType: ValidEventType | null = null;

    for (const [type, signature] of Object.entries(
        UNISWAP_V3_POSITION_EVENT_SIGNATURES,
    )) {
        if (topic0 === signature.toLowerCase()) {
            eventType = type as ValidEventType;
            break;
        }
    }

    if (!eventType) {
        return { valid: false, reason: "unknown_event" };
    }

    // Check topic[1] matches the expected nftId
    // NFT ID is stored as a 32-byte (64 hex chars) padded value
    const expectedNftIdHex =
        "0x" + BigInt(nftId).toString(16).padStart(64, "0");
    const actualNftIdHex = log.topics[1]?.toLowerCase();

    if (actualNftIdHex !== expectedNftIdHex.toLowerCase()) {
        return { valid: false, reason: "wrong_nft_id" };
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
    data: string,
): DecodedLogData {
    // Remove 0x prefix if present
    const hex = data.startsWith("0x") ? data.slice(2) : data;

    // Each ABI-encoded value is 32 bytes (64 hex chars)
    const chunks = hex.match(/.{64}/g) || [];

    if (chunks.length < 3) {
        throw new Error(
            `Invalid log data: expected at least 3 chunks, got ${chunks.length}`,
        );
    }

    if (eventType === "COLLECT") {
        // Collect: (address recipient, uint256 amount0, uint256 amount1)
        // Address is right-padded in 32 bytes, take last 40 chars (20 bytes)
        const recipientHex = chunks[0]!.slice(24); // Last 20 bytes
        return {
            recipient: "0x" + recipientHex,
            amount0: BigInt("0x" + chunks[1]!),
            amount1: BigInt("0x" + chunks[2]!),
        };
    } else {
        // IncreaseLiquidity/DecreaseLiquidity: (uint128 liquidity, uint256 amount0, uint256 amount1)
        return {
            liquidity: BigInt("0x" + chunks[0]!),
            amount0: BigInt("0x" + chunks[1]!),
            amount1: BigInt("0x" + chunks[2]!),
        };
    }
}

// ============================================================================
// DEPENDENCIES
// ============================================================================

/**
 * Dependencies for UniswapV3LedgerService.
 * All dependencies are optional and will use defaults if not provided.
 */
export interface UniswapV3LedgerServiceDependencies {
    /**
     * Prisma client for database operations.
     * If not provided, a new PrismaClient instance will be created.
     */
    prisma?: PrismaClient;

    /**
     * APR service for APR period persistence.
     * If not provided, a new UniswapV3AprService instance will be created.
     */
    aprService?: UniswapV3AprService;
}

/**
 * Configuration for UniswapV3LedgerService.
 */
export interface UniswapV3LedgerServiceConfig {
    /**
     * Position ID that this service instance operates on.
     * All methods will use this position ID.
     */
    positionId: string;
}

/**
 * Input for updating an event's calculated aggregates.
 * Used by recalculateAggregates() to fix running totals after out-of-order imports.
 */
export interface UpdateEventAggregatesInput {
    /** ID of the previous event in chronological order (null for first event) */
    previousId: string | null;
    /** Change in liquidity (delta L) */
    deltaL: bigint;
    /** Total liquidity after this event */
    liquidityAfter: bigint;
    /** Change in cost basis */
    deltaCostBasis: bigint;
    /** Cost basis after this event */
    costBasisAfter: bigint;
    /** Change in PnL */
    deltaPnl: bigint;
    /** PnL after this event */
    pnlAfter: bigint;
    /** Change in collected fees */
    deltaCollectedFees: bigint;
    /** Collected fees after this event */
    collectedFeesAfter: bigint;
    /** Uncollected principal in token0 after this event */
    uncollectedPrincipal0After: bigint;
    /** Uncollected principal in token1 after this event */
    uncollectedPrincipal1After: bigint;
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
    /** Change in collected fees */
    deltaCollectedFees: bigint;
    /** Collected fees after this event */
    collectedFeesAfter: bigint;
    /** Change in realized cashflow (always 0 for AMM positions) */
    deltaRealizedCashflow: bigint;
    /** Realized cashflow after this event (always 0 for AMM positions) */
    realizedCashflowAfter: bigint;
    /** Protocol-specific config */
    config: UniswapV3LedgerEventConfig;
    /** Protocol-specific state */
    state: UniswapV3LedgerEventState;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * UniswapV3LedgerService
 *
 * Manages position ledger events for a specific Uniswap V3 position.
 * Provides reorg-safe event identification using txHash/blockHash/logIndex.
 *
 * Each instance is scoped to a single position via the positionId parameter.
 */
export class UniswapV3LedgerService {
    protected readonly _prisma: PrismaClient;
    protected readonly logger: ServiceLogger;
    private readonly _aprService: UniswapV3AprService;
    public readonly protocol = "uniswapv3" as const;
    public readonly positionId: string;

    /**
     * Creates a new UniswapV3LedgerService instance for a specific position.
     *
     * @param config - Configuration object containing the positionId
     * @param config.positionId - Position ID that this service instance operates on
     * @param dependencies - Optional dependencies object
     * @param dependencies.prisma - Prisma client instance (creates default if not provided)
     */
    constructor(
        config: UniswapV3LedgerServiceConfig,
        dependencies: UniswapV3LedgerServiceDependencies = {},
    ) {
        this.positionId = config.positionId;
        this._prisma = dependencies.prisma ?? prismaClient;
        this.logger = createServiceLogger("UniswapV3LedgerService");
        this._aprService =
            dependencies.aprService ??
            new UniswapV3AprService(
                { positionId: config.positionId },
                { prisma: this._prisma },
            );
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
     * const hash = UniswapV3LedgerService.createHash(
     *   1,
     *   '0xabc123...',
     *   '0xdef456...',
     *   3
     * );
     * // Returns: "uniswapv3/1/0xabc123.../0xdef456.../3"
     * ```
     */
    static createHash(
        chainId: number,
        txHash: string,
        blockHash: string,
        logIndex: number,
    ): string {
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
     * const service = new UniswapV3LedgerService();
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
        return UniswapV3LedgerService.createHash(
            config.chainId,
            config.txHash,
            config.blockHash,
            config.logIndex,
        );
    }

    // ============================================================================
    // SORTING METHODS
    // ============================================================================

    /**
     * Sort events by blockchain coordinates (blockNumber ASC, logIndex ASC).
     *
     * logIndex is unique within a block (not within a transaction), so txIndex
     * is not needed for ordering.
     *
     * @param events - Array of events to sort (mutates in place)
     * @returns The sorted array (same reference)
     */
    static sortByBlockchainCoordinates<
        T extends { typedConfig: { blockNumber: bigint; logIndex: number } },
    >(events: T[]): T[] {
        return events.sort((a, b) => {
            const aConfig = a.typedConfig;
            const bConfig = b.typedConfig;

            if (aConfig.blockNumber !== bConfig.blockNumber) {
                return aConfig.blockNumber < bConfig.blockNumber ? -1 : 1;
            }
            return aConfig.logIndex - bConfig.logIndex;
        });
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
    async findIdByHash(
        inputHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<string | null> {
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
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent[]> {
        const db = tx ?? this.prisma;
        const results = await db.positionLedgerEvent.findMany({
            where: {
                positionId: this.positionId,
                config: {
                    path: ["txHash"],
                    equals: txHash,
                },
            },
        });

        return results.map((result) =>
            UniswapV3PositionLedgerEvent.fromDB(
                result as unknown as UniswapV3PositionLedgerEventRow,
            ),
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
    async findById(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent | null> {
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
            result as unknown as UniswapV3PositionLedgerEventRow,
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
    async findAll(
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent[]> {
        // Use raw SQL for deterministic ordering by blockchain coordinates.
        // timestamp-based ordering is non-deterministic for intra-block events.
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
        `;

        return results.map((result) =>
            UniswapV3PositionLedgerEvent.fromDB(
                result as unknown as UniswapV3PositionLedgerEventRow,
            ),
        );
    }

    /**
     * Create a new ledger event.
     *
     * @param input - Event data to create
     * @param tx - Optional transaction client
     * @returns The created event
     */
    async create(
        input: CreateLedgerEventInput,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent> {
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
                deltaCollectedFees: input.deltaCollectedFees.toString(),
                collectedFeesAfter: input.collectedFeesAfter.toString(),
                deltaRealizedCashflow: input.deltaRealizedCashflow.toString(),
                realizedCashflowAfter: input.realizedCashflowAfter.toString(),
                config: ledgerEventConfigToJSON(input.config) as object,
                state: ledgerEventStateToJSON(input.state) as object,
            },
        });

        return UniswapV3PositionLedgerEvent.fromDB(
            result as unknown as UniswapV3PositionLedgerEventRow,
        );
    }

    /**
     * Update an event's calculated aggregates (deltas and running totals).
     *
     * Used by recalculateAggregates() to fix running totals after out-of-order imports.
     * Updates both row-level fields and the config JSON.
     *
     * @param eventId - Database ID of the event to update
     * @param existingConfig - The existing config object (needed to preserve immutable fields)
     * @param updates - The new aggregate values
     * @param tx - Optional transaction client
     */
    private async updateEventAggregates(
        eventId: string,
        existingConfig: UniswapV3LedgerEventConfig,
        updates: UpdateEventAggregatesInput,
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        const db = tx ?? this.prisma;

        // Merge updates into existing config (preserve immutable fields like blockNumber, txHash, etc.)
        const updatedConfig: UniswapV3LedgerEventConfig = {
            ...existingConfig,
            deltaL: updates.deltaL,
            liquidityAfter: updates.liquidityAfter,
            uncollectedPrincipal0After: updates.uncollectedPrincipal0After,
            uncollectedPrincipal1After: updates.uncollectedPrincipal1After,
        };

        await db.positionLedgerEvent.update({
            where: { id: eventId },
            data: {
                previousId: updates.previousId,
                deltaCostBasis: updates.deltaCostBasis.toString(),
                costBasisAfter: updates.costBasisAfter.toString(),
                deltaPnl: updates.deltaPnl.toString(),
                pnlAfter: updates.pnlAfter.toString(),
                deltaCollectedFees: updates.deltaCollectedFees.toString(),
                collectedFeesAfter: updates.collectedFeesAfter.toString(),
                config: ledgerEventConfigToJSON(updatedConfig) as object,
            },
        });
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
    async deleteAllByBlockHash(
        blockHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<number> {
        const db = tx ?? this.prisma;
        const result = await db.positionLedgerEvent.deleteMany({
            where: {
                positionId: this.positionId,
                config: {
                    path: ["blockHash"],
                    equals: blockHash,
                },
            },
        });
        return result.count;
    }

    /**
     * Get the last (most recent) event for this position.
     *
     * Events are sorted by blockchain coordinates (blockNumber DESC, logIndex DESC).
     *
     * @param tx - Optional transaction client
     * @returns The most recent event, or null if no events exist
     */
    async findLast(
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent | null> {
        // Use raw SQL for deterministic ordering by blockchain coordinates.
        // timestamp-based ordering is non-deterministic for intra-block events
        // (e.g., DECREASE_LIQUIDITY + COLLECT in the same block share the same timestamp).
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
            LIMIT 1
        `;

        if (results.length === 0) {
            return null;
        }

        return UniswapV3PositionLedgerEvent.fromDB(
            results[0] as unknown as UniswapV3PositionLedgerEventRow,
        );
    }

    /**
     * Fetch the latest ledger event up to a specific block.
     *
     * Returns the most recent event where blockNumber <= specified block.
     * The event contains all running totals (costBasisAfter, pnlAfter, etc.)
     * making it sufficient for aggregate queries.
     *
     * @param blockNumber - Block number limit (inclusive), or 'latest' for most recent
     * @param tx - Optional transaction client
     * @returns Latest event up to block, or null if no events exist
     */
    async fetchLatestEvent(
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent | null> {
        // For 'latest', just use findLast
        if (blockNumber === "latest") {
            return this.findLast(tx);
        }

        // Use raw SQL for correct numeric comparison on blockNumber.
        // Prisma's JSON path lte uses lexicographic comparison (string-based),
        // which is incorrect: "9999999" > "21000000" lexicographically.
        // The expression index on (config->>'blockNumber')::BIGINT makes this efficient.
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
              AND (config->>'blockNumber')::BIGINT <= ${blockNumber}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
            LIMIT 1
        `;

        if (results.length === 0) {
            return null;
        }

        return UniswapV3PositionLedgerEvent.fromDB(
            results[0] as unknown as UniswapV3PositionLedgerEventRow,
        );
    }

    /**
     * Fetch the last COLLECT event up to a specific block.
     *
     * Used to determine the timestamp of the most recent fee collection
     * for APR calculations.
     *
     * @param blockNumber - Block number limit (inclusive), or 'latest' for most recent
     * @param tx - Optional transaction client
     * @returns Last COLLECT event up to block, or null if none exist
     */
    async fetchLastCollectEvent(
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent | null> {
        const db = tx ?? this.prisma;

        // Use raw SQL for correct numeric comparison and ordering.
        // See fetchLatestEvent() for explanation of the lexicographic bug.
        let results: unknown[];
        if (blockNumber === "latest") {
            results = await db.$queryRaw<unknown[]>`
                SELECT * FROM position_ledger_events
                WHERE "positionId" = ${this.positionId}
                  AND "eventType" = 'COLLECT'
                ORDER BY (config->>'blockNumber')::BIGINT DESC,
                         (config->>'logIndex')::INTEGER DESC
                LIMIT 1
            `;
        } else {
            results = await db.$queryRaw<unknown[]>`
                SELECT * FROM position_ledger_events
                WHERE "positionId" = ${this.positionId}
                  AND "eventType" = 'COLLECT'
                  AND (config->>'blockNumber')::BIGINT <= ${blockNumber}
                ORDER BY (config->>'blockNumber')::BIGINT DESC,
                         (config->>'logIndex')::INTEGER DESC
                LIMIT 1
            `;
        }

        if (results.length === 0) {
            return null;
        }

        return UniswapV3PositionLedgerEvent.fromDB(
            results[0] as unknown as UniswapV3PositionLedgerEventRow,
        );
    }

    /**
     * Fetch uncollected principal amounts up to a specific block.
     *
     * Returns the uncollectedPrincipal0After and uncollectedPrincipal1After
     * from the latest event. These represent tokens from DECREASE_LIQUIDITY
     * that haven't been collected yet.
     *
     * @param blockNumber - Block number limit (inclusive), or 'latest' for current
     * @param tx - Optional transaction client
     * @returns Uncollected principal amounts, or { 0n, 0n } if no events
     */
    async fetchUncollectedPrincipals(
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<{ uncollectedPrincipal0: bigint; uncollectedPrincipal1: bigint }> {
        const latestEvent = await this.fetchLatestEvent(blockNumber, tx);

        if (!latestEvent) {
            return { uncollectedPrincipal0: 0n, uncollectedPrincipal1: 0n };
        }

        return {
            uncollectedPrincipal0: latestEvent.typedConfig.uncollectedPrincipal0After,
            uncollectedPrincipal1: latestEvent.typedConfig.uncollectedPrincipal1After,
        };
    }

    /**
     * Recalculate and persist aggregates for all events.
     *
     * Iterates through events in blockchain order (blockNumber ASC, logIndex ASC),
     * recalculating deltas and running totals based on the correct previous state,
     * and persisting the corrected values to each event in the database.
     *
     * This method is called after importing events to ensure correct running totals.
     * It also calculates APR periods during the same iteration for efficiency.
     *
     * For point-in-time aggregate queries, use fetchLatestEvent(blockNumber) instead -
     * the latest event contains all running totals (costBasisAfter, pnlAfter, etc.).
     *
     * @param isToken0Quote - Whether token0 is the quote token (needed for fee value calculations)
     * @param tx - Optional transaction client
     * @returns Aggregated metrics after updating events
     */
    private async recalculateAggregates(
        isToken0Quote: boolean,
        tx?: PrismaTransactionClient,
    ): Promise<LedgerAggregates> {
        const events = await this.findAll(tx);

        if (events.length === 0) {
            return {
                liquidityAfter: 0n,
                costBasisAfter: 0n,
                realizedPnlAfter: 0n,
                collectedFeesAfter: 0n,
                realizedCashflowAfter: 0n,
                uncollectedPrincipal0: 0n,
                uncollectedPrincipal1: 0n,
            };
        }

        // Sort events by blockchain coordinates (blockNumber ASC, logIndex ASC)
        UniswapV3LedgerService.sortByBlockchainCoordinates(events);

        // Delete existing APR periods before recalculating
        await this._aprService.deleteAllAprPeriods(tx);

        // Initialize running totals
        let liquidityAfter = 0n;
        let costBasisAfter = 0n;
        let pnlAfter = 0n;
        let collectedFeesAfter = 0n;
        let uncollectedPrincipal0After = 0n;
        let uncollectedPrincipal1After = 0n;
        let previousEventId: string | null = null;

        // APR period tracking
        let periodStartTimestamp: Date | null = null;
        let periodStartEventId: string | null = null;
        let periodCostBasisSnapshots: Array<{
            timestamp: Date;
            costBasisAfter: bigint;
        }> = [];
        let periodEventCount = 0;

        // Process events in order, recalculating deltas and running totals
        for (const event of events) {
            const state = event.typedState;
            const config = event.typedConfig;
            const sqrtPriceX96 = config.sqrtPriceX96;

            // Previous state for this event's calculations
            const previousLiquidity = liquidityAfter;
            const previousCostBasis = costBasisAfter;
            const previousPnl = pnlAfter;
            const previousCollectedFees = collectedFeesAfter;
            const previousUncollectedPrincipal0 = uncollectedPrincipal0After;
            const previousUncollectedPrincipal1 = uncollectedPrincipal1After;

            // Calculate deltas and update running totals based on event type
            let deltaL = 0n;
            let deltaCostBasis = 0n;
            let deltaPnl = 0n;
            let deltaCollectedFees = 0n;

            if (
                state.eventType === "MINT" ||
                state.eventType === "BURN" ||
                state.eventType === "TRANSFER"
            ) {
                // Lifecycle events: no financial impact, pass through all running totals
                deltaL = 0n;
                liquidityAfter = previousLiquidity;
                deltaCostBasis = 0n;
                costBasisAfter = previousCostBasis;
                deltaPnl = 0n;
                pnlAfter = previousPnl;
                uncollectedPrincipal0After = previousUncollectedPrincipal0;
                uncollectedPrincipal1After = previousUncollectedPrincipal1;
            } else if (state.eventType === "INCREASE_LIQUIDITY") {
                // Use stored tokenValue for cost basis (already calculated with correct price)
                deltaL = state.liquidity;
                liquidityAfter = previousLiquidity + deltaL;
                deltaCostBasis = event.tokenValue;
                costBasisAfter = previousCostBasis + deltaCostBasis;
                deltaPnl = 0n;
                pnlAfter = previousPnl;
                // Uncollected principal unchanged
                uncollectedPrincipal0After = previousUncollectedPrincipal0;
                uncollectedPrincipal1After = previousUncollectedPrincipal1;
            } else if (state.eventType === "DECREASE_LIQUIDITY") {
                deltaL = -state.liquidity;
                liquidityAfter = previousLiquidity + deltaL;

                // Calculate proportional cost basis being removed
                let proportionalCostBasis = 0n;
                if (previousLiquidity > 0n && state.liquidity > 0n) {
                    proportionalCostBasis =
                        (state.liquidity * previousCostBasis) /
                        previousLiquidity;
                }
                deltaCostBasis = -proportionalCostBasis;
                costBasisAfter = previousCostBasis + deltaCostBasis;

                // Realize PnL: tokenValue (stored) vs proportional cost basis
                deltaPnl = event.tokenValue - proportionalCostBasis;
                pnlAfter = previousPnl + deltaPnl;

                // Uncollected principal INCREASES
                uncollectedPrincipal0After =
                    previousUncollectedPrincipal0 + state.amount0;
                uncollectedPrincipal1After =
                    previousUncollectedPrincipal1 + state.amount1;
            } else if (state.eventType === "COLLECT") {
                deltaL = 0n;
                liquidityAfter = previousLiquidity;
                deltaCostBasis = 0n;
                costBasisAfter = previousCostBasis;

                // Determine principal vs fees
                const principal0Collected =
                    state.amount0 <= previousUncollectedPrincipal0
                        ? state.amount0
                        : previousUncollectedPrincipal0;
                const principal1Collected =
                    state.amount1 <= previousUncollectedPrincipal1
                        ? state.amount1
                        : previousUncollectedPrincipal1;

                const feesCollected0 = state.amount0 - principal0Collected;
                const feesCollected1 = state.amount1 - principal1Collected;

                // Calculate fee value in quote tokens
                let feeValue: bigint;
                if (isToken0Quote) {
                    const fees1InQuote = valueOfToken1AmountInToken0(
                        feesCollected1,
                        sqrtPriceX96,
                    );
                    feeValue = feesCollected0 + fees1InQuote;
                } else {
                    const fees0InQuote = valueOfToken0AmountInToken1(
                        feesCollected0,
                        sqrtPriceX96,
                    );
                    feeValue = fees0InQuote + feesCollected1;
                }

                deltaPnl = feeValue;
                pnlAfter = previousPnl + deltaPnl;
                deltaCollectedFees = feeValue;
                collectedFeesAfter = previousCollectedFees + deltaCollectedFees;

                // Uncollected principal decreases
                uncollectedPrincipal0After =
                    previousUncollectedPrincipal0 - principal0Collected;
                uncollectedPrincipal1After =
                    previousUncollectedPrincipal1 - principal1Collected;
            }

            // ================================================================
            // APR Period Tracking
            // ================================================================

            // Initialize period on first event
            if (periodStartTimestamp === null) {
                periodStartTimestamp = event.timestamp;
                periodStartEventId = event.id;
            }

            // Track cost basis snapshot for time-weighted calculation
            periodCostBasisSnapshots.push({
                timestamp: event.timestamp,
                costBasisAfter: costBasisAfter,
            });
            periodEventCount++;

            // COLLECT event ends the current APR period
            if (state.eventType === "COLLECT") {
                // Only create period if we have meaningful data (at least 2 snapshots for duration)
                if (
                    periodStartTimestamp &&
                    periodCostBasisSnapshots.length >= 2
                ) {
                    try {
                        const timeWeightedCostBasis =
                            calculateTimeWeightedCostBasis(
                                periodCostBasisSnapshots,
                            );
                        const durationSeconds = calculateDurationSeconds(
                            periodStartTimestamp,
                            event.timestamp,
                        );

                        // Calculate APR if we have valid cost basis and duration
                        const aprBps =
                            durationSeconds > 0 && timeWeightedCostBasis > 0n
                                ? calculateAprBps(
                                      deltaCollectedFees,
                                      timeWeightedCostBasis,
                                      durationSeconds,
                                  )
                                : 0;

                        const aprPeriod: AprPeriodData = {
                            startEventId: periodStartEventId!,
                            endEventId: event.id,
                            startTimestamp: periodStartTimestamp,
                            endTimestamp: event.timestamp,
                            durationSeconds,
                            costBasis: timeWeightedCostBasis,
                            collectedFeeValue: deltaCollectedFees,
                            aprBps,
                            eventCount: periodEventCount,
                        };

                        // Persist immediately
                        await this._aprService.persistAprPeriod(aprPeriod, tx);
                    } catch (e) {
                        // Skip invalid periods (e.g., zero duration, same timestamps)
                        this.logger.warn(
                            { error: e },
                            "Skipping invalid APR period",
                        );
                    }
                }

                // Reset for next period - COLLECT ends this period, next event starts new one
                periodStartTimestamp = event.timestamp;
                periodStartEventId = event.id;
                periodCostBasisSnapshots = [
                    { timestamp: event.timestamp, costBasisAfter },
                ];
                periodEventCount = 0;
            }

            // ================================================================
            // Update event in database with corrected values
            // ================================================================
            await this.updateEventAggregates(
                event.id,
                config,
                {
                    previousId: previousEventId,
                    deltaL,
                    liquidityAfter,
                    deltaCostBasis,
                    costBasisAfter,
                    deltaPnl,
                    pnlAfter,
                    deltaCollectedFees,
                    collectedFeesAfter,
                    uncollectedPrincipal0After,
                    uncollectedPrincipal1After,
                },
                tx,
            );

            // This event becomes the previous event for the next iteration
            previousEventId = event.id;
        }

        return {
            liquidityAfter,
            costBasisAfter,
            realizedPnlAfter: pnlAfter,
            collectedFeesAfter,
            realizedCashflowAfter: 0n, // Always 0 for AMM positions
            uncollectedPrincipal0: uncollectedPrincipal0After,
            uncollectedPrincipal1: uncollectedPrincipal1After,
        };
    }

    // ============================================================================
    // LIFECYCLE EVENT METHODS
    // ============================================================================

    /**
     * Create a lifecycle ledger event (MINT, BURN, or TRANSFER).
     *
     * These events have deltaL=0 and no financial impact. They serve as
     * lifecycle markers in the position ledger.
     *
     * @param params - Lifecycle event parameters
     * @param params.chainId - EVM chain ID
     * @param params.nftId - NFT token ID
     * @param params.blockNumber - Block number of the event
     * @param params.txIndex - Transaction index
     * @param params.logIndex - Log index
     * @param params.txHash - Transaction hash
     * @param params.blockHash - Block hash
     * @param params.timestamp - Block timestamp
     * @param params.sqrtPriceX96 - Pool price at event time
     * @param params.state - Event-specific state (UniswapV3MintEvent, UniswapV3BurnEvent, or UniswapV3TransferEvent)
     * @param tx - Optional transaction client
     * @returns The created event, or null if already exists
     */
    async createLifecycleEvent(
        params: {
            chainId: number;
            nftId: bigint;
            blockNumber: bigint;
            txIndex: number;
            logIndex: number;
            txHash: string;
            blockHash: string;
            timestamp: Date;
            sqrtPriceX96: bigint;
            state: UniswapV3LedgerEventState;
        },
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionLedgerEvent | null> {
        const inputHash = UniswapV3LedgerService.createHash(
            params.chainId,
            params.txHash,
            params.blockHash,
            params.logIndex,
        );

        // Dedup check
        const existingId = await this.findIdByHash(inputHash, tx);
        if (existingId) {
            this.logger.debug({ inputHash }, "Lifecycle event already exists, skipping");
            return null;
        }

        // Map state eventType to ledger EventType
        const eventType = params.state.eventType as EventType;

        const config: UniswapV3LedgerEventConfig = {
            chainId: params.chainId,
            nftId: params.nftId,
            blockNumber: params.blockNumber,
            txIndex: params.txIndex,
            logIndex: params.logIndex,
            txHash: params.txHash,
            blockHash: params.blockHash,
            deltaL: 0n,
            liquidityAfter: 0n, // Will be fixed by recalculateAggregates
            feesCollected0: 0n,
            feesCollected1: 0n,
            uncollectedPrincipal0After: 0n,
            uncollectedPrincipal1After: 0n,
            sqrtPriceX96: params.sqrtPriceX96,
        };

        const createInput: CreateLedgerEventInput = {
            previousId: null, // Will be fixed by recalculateAggregates
            timestamp: params.timestamp,
            eventType,
            inputHash,
            poolPrice: params.sqrtPriceX96,
            token0Amount: 0n,
            token1Amount: 0n,
            tokenValue: 0n,
            rewards: [],
            deltaCostBasis: 0n,
            costBasisAfter: 0n,
            deltaPnl: 0n,
            pnlAfter: 0n,
            deltaCollectedFees: 0n,
            collectedFeesAfter: 0n,
            deltaRealizedCashflow: 0n,
            realizedCashflowAfter: 0n,
            config,
            state: params.state,
        };

        const event = await this.create(createInput, tx);

        this.logger.info(
            { inputHash, eventType, positionId: this.positionId },
            "Lifecycle ledger event created",
        );

        return event;
    }

    // ============================================================================
    // IMPORT METHODS
    // ============================================================================

    /**
     * Import multiple raw log events into the ledger database.
     *
     * This is the primary method for importing events. It:
     * 1. Processes each log (validation, dedup, reorg detection, event creation)
     * 2. Calls recalculateAggregates() once at the end to fix all running totals
     *
     * Events can be imported in any order - the recalculation ensures correct
     * running totals based on blockchain coordinates (blockNumber, logIndex).
     *
     * @param position - UniswapV3Position (provides pool, tokens, isToken0Quote)
     * @param chainId - EVM chain ID
     * @param logs - Array of raw log data from eth_getLogs or eth_subscribe
     * @param poolPriceService - Pool price service for discovering prices at specific blocks
     * @param tx - Optional Prisma transaction client
     * @returns Import results for each log and final aggregates
     */
    async importLogsForPosition(
        position: UniswapV3Position,
        chainId: number,
        logs: RawLogInput[],
        poolPriceService: UniswapV3PoolPriceService,
        tx?: PrismaTransactionClient,
    ): Promise<ImportLogsResult> {
        // Snapshot aggregates before import for delta calculations
        const preImportAggregates = await this.recalculateAggregates(
            position.isToken0Quote,
            tx,
        );

        const results: SingleLogResult[] = [];

        for (const log of logs) {
            const result = await this.processSingleLog(
                position,
                chainId,
                log,
                poolPriceService,
                tx,
            );
            results.push(result);
        }

        // Recalculate all aggregates to ensure correct running totals
        // APR periods are persisted internally during recalculation
        const aggregates = await this.recalculateAggregates(
            position.isToken0Quote,
            tx,
        );

        return { results, preImportAggregates, aggregates };
    }

    /**
     * Process a single raw log event.
     *
     * Handles validation, deduplication, reorg detection, and event creation.
     * Does NOT recalculate aggregates - that's done by the caller after all
     * events are processed.
     *
     * @param position - UniswapV3Position
     * @param chainId - EVM chain ID
     * @param log - Raw log data
     * @param poolPriceService - Pool price service
     * @param tx - Optional transaction client
     * @returns Single log result (no aggregates)
     */
    private async processSingleLog(
        position: UniswapV3Position,
        chainId: number,
        log: RawLogInput,
        poolPriceService: UniswapV3PoolPriceService,
        tx?: PrismaTransactionClient,
    ): Promise<SingleLogResult> {
        const nftId = position.typedConfig.nftId;

        // Validate the raw event
        const validation = validateRawEvent(chainId, nftId, log);
        if (validation.valid === false) {
            this.logger.debug(
                { positionId: this.positionId, reason: validation.reason },
                "Invalid event skipped",
            );
            return { action: "skipped", reason: "invalid_event" };
        }

        // Parse numeric fields from log
        const logIndex =
            typeof log.logIndex === "string"
                ? parseInt(
                      log.logIndex,
                      log.logIndex.startsWith("0x") ? 16 : 10,
                  )
                : log.logIndex;

        const txIndex =
            typeof log.transactionIndex === "string"
                ? parseInt(
                      log.transactionIndex,
                      log.transactionIndex.startsWith("0x") ? 16 : 10,
                  )
                : log.transactionIndex;

        const blockNumber =
            typeof log.blockNumber === "string"
                ? BigInt(log.blockNumber)
                : log.blockNumber;

        // Compute the input hash for this event
        const inputHash = UniswapV3LedgerService.createHash(
            chainId,
            log.transactionHash,
            log.blockHash,
            logIndex,
        );

        // Handle reorg case: remove all events from this block
        if (log.removed) {
            const deletedCount = await this.deleteAllByBlockHash(
                log.blockHash,
                tx,
            );
            if (deletedCount > 0) {
                this.logger.info(
                    { blockHash: log.blockHash, deletedCount },
                    "Events removed due to reorg",
                );
            }
            return { action: "removed", inputHash, deletedCount, blockHash: log.blockHash };
        }

        // Check if event already exists
        const existingId = await this.findIdByHash(inputHash, tx);
        if (existingId) {
            this.logger.debug({ inputHash }, "Event already exists, skipping");
            return { action: "skipped", reason: "already_exists" };
        }

        // Check for catch-up reorg: same txHash but different blockHash
        const eventsWithSameTxHash = await this.findByTxHash(
            log.transactionHash,
            tx,
        );
        for (const existingEvent of eventsWithSameTxHash) {
            const existingBlockHash = existingEvent.typedConfig.blockHash;
            if (existingBlockHash !== log.blockHash) {
                this.logger.debug(
                    {
                        txHash: log.transactionHash,
                        orphanedBlockHash: existingBlockHash,
                        canonicalBlockHash: log.blockHash,
                    },
                    "Catch-up reorg detected: removing events from orphaned fork",
                );
                await this.deleteAllByBlockHash(existingBlockHash, tx);
                break;
            }
        }

        // Discover pool price at the event's block number
        const poolPrice = await poolPriceService.discover(
            position.pool.id,
            { blockNumber: Number(blockNumber) },
            tx,
        );
        const sqrtPriceX96 = poolPrice.sqrtPriceX96;
        const blockTimestamp = poolPrice.timestamp;

        // Decode the log data
        const decoded = decodeLogData(validation.eventType, log.data);

        // Calculate token value in quote tokens
        let tokenValue: bigint;
        if (position.isToken0Quote) {
            const amount1InQuote = valueOfToken1AmountInToken0(
                decoded.amount1,
                sqrtPriceX96,
            );
            tokenValue = decoded.amount0 + amount1InQuote;
        } else {
            const amount0InQuote = valueOfToken0AmountInToken1(
                decoded.amount0,
                sqrtPriceX96,
            );
            tokenValue = amount0InQuote + decoded.amount1;
        }

        // Map ValidEventType to EventType for database
        const eventTypeMap: Record<ValidEventType, EventType> = {
            INCREASE_LIQUIDITY: "INCREASE_POSITION",
            DECREASE_LIQUIDITY: "DECREASE_POSITION",
            COLLECT: "COLLECT",
        };
        const eventType = eventTypeMap[validation.eventType];

        // Build ledger event config (running totals will be fixed by recalculateAggregates)
        const deltaL =
            validation.eventType === "INCREASE_LIQUIDITY"
                ? (decoded.liquidity ?? 0n)
                : validation.eventType === "DECREASE_LIQUIDITY"
                  ? -(decoded.liquidity ?? 0n)
                  : 0n;

        const ledgerConfig: UniswapV3LedgerEventConfig = {
            chainId,
            nftId: BigInt(nftId),
            blockNumber,
            txIndex,
            logIndex,
            txHash: log.transactionHash,
            blockHash: log.blockHash,
            deltaL,
            liquidityAfter: 0n, // Will be fixed by recalculateAggregates
            feesCollected0: 0n, // Will be fixed by recalculateAggregates
            feesCollected1: 0n, // Will be fixed by recalculateAggregates
            uncollectedPrincipal0After: 0n, // Will be fixed by recalculateAggregates
            uncollectedPrincipal1After: 0n, // Will be fixed by recalculateAggregates
            sqrtPriceX96,
        };

        // Build ledger event state
        const tokenIdBigInt = BigInt(nftId);
        let ledgerState: UniswapV3LedgerEventState;
        if (validation.eventType === "INCREASE_LIQUIDITY") {
            ledgerState = {
                eventType: "INCREASE_LIQUIDITY",
                tokenId: tokenIdBigInt,
                liquidity: decoded.liquidity ?? 0n,
                amount0: decoded.amount0,
                amount1: decoded.amount1,
            };
        } else if (validation.eventType === "DECREASE_LIQUIDITY") {
            ledgerState = {
                eventType: "DECREASE_LIQUIDITY",
                tokenId: tokenIdBigInt,
                liquidity: decoded.liquidity ?? 0n,
                amount0: decoded.amount0,
                amount1: decoded.amount1,
            };
        } else {
            ledgerState = {
                eventType: "COLLECT",
                tokenId: tokenIdBigInt,
                recipient: decoded.recipient ?? "",
                amount0: decoded.amount0,
                amount1: decoded.amount1,
            };
        }

        // Create the ledger event (with placeholder running totals)
        const createInput: CreateLedgerEventInput = {
            previousId: null, // Will be fixed by recalculateAggregates
            timestamp: blockTimestamp,
            eventType,
            inputHash,
            poolPrice: sqrtPriceX96,
            token0Amount: decoded.amount0,
            token1Amount: decoded.amount1,
            tokenValue,
            rewards: [],
            deltaCostBasis: 0n, // Will be fixed by recalculateAggregates
            costBasisAfter: 0n, // Will be fixed by recalculateAggregates
            deltaPnl: 0n, // Will be fixed by recalculateAggregates
            pnlAfter: 0n, // Will be fixed by recalculateAggregates
            deltaCollectedFees: 0n, // Will be fixed by recalculateAggregates
            collectedFeesAfter: 0n, // Will be fixed by recalculateAggregates
            deltaRealizedCashflow: 0n,
            realizedCashflowAfter: 0n,
            config: ledgerConfig,
            state: ledgerState,
        };

        await this.create(createInput, tx);

        this.logger.debug(
            { inputHash, eventType: validation.eventType },
            "Ledger event created (aggregates pending recalculation)",
        );

        return {
            action: "inserted",
            inputHash,
            eventDetail: {
                validEventType: validation.eventType,
                amount0: decoded.amount0,
                amount1: decoded.amount1,
                liquidityDelta: decoded.liquidity ?? 0n,
                tokenValue,
                blockTimestamp,
            },
        };
    }

}
