/**
 * UniswapV3 Vault Ledger Service
 *
 * Manages ledger events for vault share positions.
 * Follows the same architecture as UniswapV3LedgerService:
 * - Per-position instance (positionId in constructor)
 * - Placeholder aggregates on insert, recalculate once at end
 * - APR periods persist during recalculation
 * - Event chaining via previousId
 * - Reorg detection via blockHash comparison
 *
 * Event types: VAULT_COLLECT_YIELD, VAULT_TRANSFER_IN, VAULT_TRANSFER_OUT
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
    UniswapV3VaultPositionLedgerEvent,
    vaultLedgerEventConfigToJSON,
    vaultLedgerEventStateToJSON,
    valueOfToken0AmountInToken1,
    valueOfToken1AmountInToken0,
    calculatePositionValue,
} from '@midcurve/shared';
import type {
    UniswapV3VaultPositionLedgerEventRow,
    UniswapV3VaultLedgerEventConfig,
    UniswapV3VaultLedgerEventState,
    EventType,
    Reward,
} from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import {
    calculateAprBps,
    calculateDurationSeconds,
    calculateTimeWeightedCostBasis,
} from '../../utils/apr/apr-calculations.js';
import { UniswapV3AprService } from '../position-apr/uniswapv3-apr-service.js';
import type { AprPeriodData } from '../types/position-apr/index.js';

// ============================================================================
// EVENT SIGNATURES
// ============================================================================

/**
 * Vault contract event signatures (topic0 values).
 * Computed via cast sig-event from the Solidity event definitions.
 */
export const VAULT_EVENT_SIGNATURES = {
    FEES_COLLECTED: '0x2e4fb6077d4acf86e12bb7411fb82b2b3eaa6a49787f4b1e17b423e7ea841169',
    TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const;

export type ValidVaultEventType = keyof typeof VAULT_EVENT_SIGNATURES;

// ============================================================================
// RAW LOG TYPES
// ============================================================================

/**
 * Raw log data from eth_getLogs. Compatible with viem's Log type.
 */
export interface VaultRawLogInput {
    address: string;
    topics: readonly string[];
    data: string;
    blockNumber: string | bigint;
    blockHash: string;
    transactionHash: string;
    transactionIndex: string | number;
    logIndex: string | number;
    removed?: boolean;
}

// ============================================================================
// VALIDATION
// ============================================================================

export type ValidateVaultEventResult =
    | { valid: true; eventType: ValidVaultEventType }
    | { valid: false; reason: 'wrong_contract' | 'unknown_event' | 'missing_topics' | 'wrong_user' };

/**
 * Validate a raw vault event log.
 *
 * @param vaultAddress - Expected vault contract address
 * @param userAddress - User address to filter by (for indexed params)
 * @param log - Raw log data
 */
export function validateVaultEvent(
    vaultAddress: string,
    userAddress: string,
    log: VaultRawLogInput,
): ValidateVaultEventResult {
    // Check contract address
    if (log.address.toLowerCase() !== vaultAddress.toLowerCase()) {
        return { valid: false, reason: 'wrong_contract' };
    }

    if (!log.topics || log.topics.length < 2) {
        return { valid: false, reason: 'missing_topics' };
    }

    // Match topic0 to event signature
    const topic0 = log.topics[0]?.toLowerCase();
    let eventType: ValidVaultEventType | null = null;

    for (const [type, signature] of Object.entries(VAULT_EVENT_SIGNATURES)) {
        if (topic0 === signature.toLowerCase()) {
            eventType = type as ValidVaultEventType;
            break;
        }
    }

    if (!eventType) {
        return { valid: false, reason: 'unknown_event' };
    }

    // Validate indexed user param
    const userHex = '0x' + userAddress.toLowerCase().slice(2).padStart(64, '0');

    if (eventType === 'TRANSFER') {
        // Transfer has two indexed params: from (topic1), to (topic2)
        if (log.topics.length < 3) return { valid: false, reason: 'missing_topics' };
        const from = log.topics[1]?.toLowerCase();
        const to = log.topics[2]?.toLowerCase();
        if (from !== userHex && to !== userHex) {
            return { valid: false, reason: 'wrong_user' };
        }
    } else {
        // FeesCollected(user) — topic1 is the user
        const indexedUser = log.topics[1]?.toLowerCase();
        if (indexedUser !== userHex) {
            return { valid: false, reason: 'wrong_user' };
        }
    }

    return { valid: true, eventType };
}

// ============================================================================
// DECODING
// ============================================================================

export interface DecodedVaultFeesCollectedData {
    eventType: 'FEES_COLLECTED';
    fee0: bigint;
    fee1: bigint;
}

export interface DecodedVaultTransferData {
    eventType: 'TRANSFER';
    value: bigint;
}

export type DecodedVaultLogData =
    | DecodedVaultFeesCollectedData
    | DecodedVaultTransferData;

/**
 * Decode ABI-encoded log data for vault events.
 */
export function decodeVaultLogData(
    eventType: ValidVaultEventType,
    data: string,
): DecodedVaultLogData {
    const hex = data.startsWith('0x') ? data.slice(2) : data;
    const chunks = hex.match(/.{64}/g) || [];

    switch (eventType) {
        case 'FEES_COLLECTED': {
            // (uint256 fee0, uint256 fee1)
            if (chunks.length < 2) throw new Error(`Invalid FEES_COLLECTED data: expected 2 chunks, got ${chunks.length}`);
            return {
                eventType: 'FEES_COLLECTED',
                fee0: BigInt('0x' + chunks[0]!),
                fee1: BigInt('0x' + chunks[1]!),
            };
        }
        case 'TRANSFER': {
            // (uint256 value)
            if (chunks.length < 1) throw new Error(`Invalid TRANSFER data: expected 1 chunk, got ${chunks.length}`);
            return {
                eventType: 'TRANSFER',
                value: BigInt('0x' + chunks[0]!),
            };
        }
    }
}

// ============================================================================
// CREATE INPUT
// ============================================================================

export interface CreateVaultLedgerEventInput {
    previousId: string | null;
    timestamp: Date;
    eventType: EventType;
    inputHash: string;
    tokenValue: bigint;
    rewards: Reward[];
    deltaCostBasis: bigint;
    costBasisAfter: bigint;
    deltaPnl: bigint;
    pnlAfter: bigint;
    deltaCollectedYield: bigint;
    collectedYieldAfter: bigint;
    deltaRealizedCashflow: bigint;
    realizedCashflowAfter: bigint;
    config: UniswapV3VaultLedgerEventConfig;
    state: UniswapV3VaultLedgerEventState;
}

// ============================================================================
// AGGREGATES
// ============================================================================

export interface VaultLedgerAggregates {
    sharesAfter: bigint;
    costBasisAfter: bigint;
    realizedPnlAfter: bigint;
    collectedYieldAfter: bigint;
    realizedCashflowAfter: bigint;
}

// ============================================================================
// IMPORT RESULT
// ============================================================================

export type VaultSingleLogResult =
    | {
          action: 'inserted';
          inputHash: string;
          eventDetail: {
              eventType: EventType;
              shares: bigint;
              tokenValue: bigint;
              blockTimestamp: Date;
          };
          reorgDeletedEvents?: UniswapV3VaultPositionLedgerEvent[];
      }
    | { action: 'removed'; inputHash: string; deletedEvents: UniswapV3VaultPositionLedgerEvent[]; blockHash: string }
    | { action: 'skipped'; reason: 'already_exists' | 'invalid_event' };

export interface VaultImportLogsResult {
    perLogResults: VaultSingleLogResult[];
    allDeletedEvents: UniswapV3VaultPositionLedgerEvent[];
    preImportAggregates: VaultLedgerAggregates;
    postImportAggregates: VaultLedgerAggregates;
}

// ============================================================================
// UPDATE AGGREGATES INPUT
// ============================================================================

interface UpdateVaultEventAggregatesInput {
    previousId: string | null;
    sharesAfter: bigint;
    deltaCostBasis: bigint;
    costBasisAfter: bigint;
    deltaPnl: bigint;
    pnlAfter: bigint;
    deltaCollectedYield: bigint;
    collectedYieldAfter: bigint;
}

// ============================================================================
// SERVICE CONFIG
// ============================================================================

export interface UniswapV3VaultLedgerServiceConfig {
    positionId: string;
}

export interface UniswapV3VaultLedgerServiceDependencies {
    prisma?: PrismaClient;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3VaultLedgerService {
    private readonly prisma: PrismaClient;
    private readonly positionId: string;
    private readonly protocol = 'uniswapv3-vault' as const;
    private readonly logger: ServiceLogger;
    private readonly _aprService: UniswapV3AprService;

    constructor(
        config: UniswapV3VaultLedgerServiceConfig,
        deps: UniswapV3VaultLedgerServiceDependencies = {},
    ) {
        this.positionId = config.positionId;
        this.prisma = deps.prisma ?? prismaClient;
        this.logger = createServiceLogger('uniswapv3-vault-ledger');
        this._aprService = new UniswapV3AprService(
            { positionId: config.positionId },
            { prisma: this.prisma },
        );
    }

    // ============================================================================
    // STATIC HELPERS
    // ============================================================================

    /**
     * Create a deterministic, reorg-safe input hash for deduplication.
     */
    static createHash(
        chainId: number,
        txHash: string,
        blockHash: string,
        logIndex: number,
    ): string {
        return `uniswapv3-vault/${chainId}/${txHash}/${blockHash}/${logIndex}`;
    }

    /**
     * Sort events by blockchain coordinates (blockNumber ASC, logIndex ASC).
     */
    private static sortByBlockchainCoordinates<
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

    async findIdByHash(
        inputHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<string | null> {
        const db = tx ?? this.prisma;
        const result = await db.positionLedgerEvent.findFirst({
            where: { positionId: this.positionId, inputHash },
            select: { id: true },
        });
        return result?.id ?? null;
    }

    async findByTxHash(
        txHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPositionLedgerEvent[]> {
        const db = tx ?? this.prisma;
        const results = await db.positionLedgerEvent.findMany({
            where: {
                positionId: this.positionId,
                config: { path: ['txHash'], equals: txHash },
            },
        });
        return results.map((r) =>
            UniswapV3VaultPositionLedgerEvent.fromDB(r as unknown as UniswapV3VaultPositionLedgerEventRow),
        );
    }

    // ============================================================================
    // CRUD METHODS
    // ============================================================================

    async findAll(tx?: PrismaTransactionClient): Promise<UniswapV3VaultPositionLedgerEvent[]> {
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
        `;
        return results.map((r) =>
            UniswapV3VaultPositionLedgerEvent.fromDB(r as unknown as UniswapV3VaultPositionLedgerEventRow),
        );
    }

    async findLast(tx?: PrismaTransactionClient): Promise<UniswapV3VaultPositionLedgerEvent | null> {
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
            LIMIT 1
        `;
        if (results.length === 0) return null;
        return UniswapV3VaultPositionLedgerEvent.fromDB(results[0] as unknown as UniswapV3VaultPositionLedgerEventRow);
    }

    async create(
        input: CreateVaultLedgerEventInput,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPositionLedgerEvent> {
        const db = tx ?? this.prisma;
        const result = await db.positionLedgerEvent.create({
            data: {
                positionId: this.positionId,
                protocol: this.protocol,
                previousId: input.previousId,
                timestamp: input.timestamp,
                eventType: input.eventType,
                inputHash: input.inputHash,
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
                deltaCollectedYield: input.deltaCollectedYield.toString(),
                collectedYieldAfter: input.collectedYieldAfter.toString(),
                deltaRealizedCashflow: input.deltaRealizedCashflow.toString(),
                realizedCashflowAfter: input.realizedCashflowAfter.toString(),
                config: vaultLedgerEventConfigToJSON(input.config) as object,
                state: vaultLedgerEventStateToJSON(input.state) as object,
            },
        });
        return UniswapV3VaultPositionLedgerEvent.fromDB(
            result as unknown as UniswapV3VaultPositionLedgerEventRow,
        );
    }

    async deleteAll(tx?: PrismaTransactionClient): Promise<void> {
        const db = tx ?? this.prisma;
        await db.positionLedgerEvent.deleteMany({
            where: { positionId: this.positionId },
        });
    }

    async deleteAllByBlockHash(
        blockHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPositionLedgerEvent[]> {
        const db = tx ?? this.prisma;
        const toDelete = await db.positionLedgerEvent.findMany({
            where: {
                positionId: this.positionId,
                config: { path: ['blockHash'], equals: blockHash },
            },
        });

        if (toDelete.length > 0) {
            await db.positionLedgerEvent.deleteMany({
                where: { id: { in: toDelete.map((e) => e.id) } },
            });
        }

        return toDelete.map((r) =>
            UniswapV3VaultPositionLedgerEvent.fromDB(r as unknown as UniswapV3VaultPositionLedgerEventRow),
        );
    }

    // ============================================================================
    // IMPORT ORCHESTRATOR
    // ============================================================================

    /**
     * Import raw blockchain logs and recalculate all aggregates.
     *
     * Two-pass pattern:
     * 1. Insert events with placeholder zeros
     * 2. Recalculate all running totals at end
     */
    async importLogsForPosition(
        position: { typedConfig: { isToken0Quote: boolean; vaultAddress: string; poolAddress: string; tickLower: number; tickUpper: number } },
        chainId: number,
        userAddress: string,
        logs: VaultRawLogInput[],
        poolPriceService: UniswapV3PoolPriceService,
        tx?: PrismaTransactionClient,
    ): Promise<VaultImportLogsResult> {
        const preImportAggregates = await this.recalculateAggregates(
            position.typedConfig.isToken0Quote,
            tx,
        );

        const perLogResults: VaultSingleLogResult[] = [];
        const allDeletedEvents: UniswapV3VaultPositionLedgerEvent[] = [];

        for (const log of logs) {
            const result = await this.processSingleLog(
                position,
                chainId,
                userAddress,
                log,
                poolPriceService,
                tx,
            );
            perLogResults.push(result);
            if (result.action === 'removed') {
                allDeletedEvents.push(...result.deletedEvents);
            } else if (result.action === 'inserted' && result.reorgDeletedEvents) {
                allDeletedEvents.push(...result.reorgDeletedEvents);
            }
        }

        const postImportAggregates = await this.recalculateAggregates(
            position.typedConfig.isToken0Quote,
            tx,
        );

        return { perLogResults, allDeletedEvents, preImportAggregates, postImportAggregates };
    }

    // ============================================================================
    // SINGLE LOG PROCESSOR
    // ============================================================================

    private async processSingleLog(
        position: { typedConfig: { isToken0Quote: boolean; vaultAddress: string; poolAddress: string; tickLower: number; tickUpper: number } },
        chainId: number,
        userAddress: string,
        log: VaultRawLogInput,
        poolPriceService: UniswapV3PoolPriceService,
        tx?: PrismaTransactionClient,
    ): Promise<VaultSingleLogResult> {
        // 1. Validate
        const validation = validateVaultEvent(position.typedConfig.vaultAddress, userAddress, log);
        if (!validation.valid) {
            this.logger.debug({ reason: validation.reason }, 'Invalid vault event skipped');
            return { action: 'skipped', reason: 'invalid_event' };
        }

        // 2. Parse numeric fields
        const logIndex = typeof log.logIndex === 'string'
            ? parseInt(log.logIndex, log.logIndex.startsWith('0x') ? 16 : 10)
            : log.logIndex;
        const txIndex = typeof log.transactionIndex === 'string'
            ? parseInt(log.transactionIndex, log.transactionIndex.startsWith('0x') ? 16 : 10)
            : log.transactionIndex;
        const blockNumber = typeof log.blockNumber === 'string'
            ? BigInt(log.blockNumber)
            : log.blockNumber;

        // 3. Compute inputHash
        const inputHash = UniswapV3VaultLedgerService.createHash(
            chainId, log.transactionHash, log.blockHash, logIndex,
        );

        // 4. Handle active reorg
        if (log.removed) {
            const deletedEvents = await this.deleteAllByBlockHash(log.blockHash, tx);
            if (deletedEvents.length > 0) {
                this.logger.info({ blockHash: log.blockHash, deletedCount: deletedEvents.length }, 'Events removed due to reorg');
            }
            return { action: 'removed', inputHash, deletedEvents, blockHash: log.blockHash };
        }

        // 5. Dedup check
        const existingId = await this.findIdByHash(inputHash, tx);
        if (existingId) {
            return { action: 'skipped', reason: 'already_exists' };
        }

        // 6. Catch-up reorg detection
        let reorgDeletedEvents: UniswapV3VaultPositionLedgerEvent[] | undefined;
        const eventsWithSameTxHash = await this.findByTxHash(log.transactionHash, tx);
        for (const existing of eventsWithSameTxHash) {
            const existingBlockHash = existing.typedConfig.blockHash;
            if (existingBlockHash !== log.blockHash) {
                this.logger.debug(
                    { txHash: log.transactionHash, orphanedBlockHash: existingBlockHash, canonicalBlockHash: log.blockHash },
                    'Catch-up reorg detected',
                );
                reorgDeletedEvents = await this.deleteAllByBlockHash(existingBlockHash, tx);
                break;
            }
        }

        // 7. Discover pool price at event block
        const poolPrice = await poolPriceService.discover(
            { chainId, poolAddress: position.typedConfig.poolAddress },
            { blockNumber: Number(blockNumber), blockHash: log.blockHash },
        );
        const sqrtPriceX96 = poolPrice.sqrtPriceX96;
        const blockTimestamp = poolPrice.timestamp;

        // 8. Decode log data
        const decoded = decodeVaultLogData(validation.eventType, log.data);

        // 9. Determine event type + calculate tokenValue + build state
        let eventType: EventType;
        let tokenValue: bigint;
        let shares: bigint;
        let ledgerState: UniswapV3VaultLedgerEventState;

        const userHex = '0x' + userAddress.toLowerCase().slice(2).padStart(64, '0');

        if (decoded.eventType === 'FEES_COLLECTED') {
            eventType = 'VAULT_COLLECT_YIELD';
            shares = 0n;
            tokenValue = this.calculateTokenValue(decoded.fee0, decoded.fee1, sqrtPriceX96, position.typedConfig.isToken0Quote);
            ledgerState = {
                eventType: 'VAULT_COLLECT_YIELD',
                fee0: decoded.fee0,
                fee1: decoded.fee1,
                poolPrice: sqrtPriceX96,
                token0Amount: decoded.fee0,
                token1Amount: decoded.fee1,
            };
        } else {
            // TRANSFER — single source of truth for all share movements.
            // Mints (from 0x0) and burns (to 0x0) are handled here as transfer-in/out.
            // Since totalSupply == liquidity (vault invariant), shares == liquidity delta,
            // so we can use calculatePositionValue with shares as liquidity.
            const from = log.topics[1]?.toLowerCase();
            shares = decoded.value;
            tokenValue = calculatePositionValue(
                decoded.value,
                sqrtPriceX96,
                position.typedConfig.tickLower,
                position.typedConfig.tickUpper,
                !position.typedConfig.isToken0Quote, // baseIsToken0
            );

            if (from === userHex) {
                // Transfer FROM owner (includes burn to 0x0)
                eventType = 'VAULT_TRANSFER_OUT';
                const to = log.topics[2]!;
                const toAddress = '0x' + to.slice(26);
                ledgerState = {
                    eventType: 'VAULT_TRANSFER_OUT',
                    shares: decoded.value,
                    to: toAddress,
                    poolPrice: sqrtPriceX96,
                    token0Amount: 0n,
                    token1Amount: 0n,
                };
            } else {
                // Transfer TO owner (includes mint from 0x0)
                eventType = 'VAULT_TRANSFER_IN';
                const fromAddress = '0x' + from!.slice(26);
                ledgerState = {
                    eventType: 'VAULT_TRANSFER_IN',
                    shares: decoded.value,
                    from: fromAddress,
                    poolPrice: sqrtPriceX96,
                    token0Amount: 0n,
                    token1Amount: 0n,
                };
            }
        }

        // 10. Build config with placeholder running totals
        const ledgerConfig: UniswapV3VaultLedgerEventConfig = {
            chainId,
            vaultAddress: position.typedConfig.vaultAddress,
            blockNumber,
            txIndex,
            logIndex,
            txHash: log.transactionHash,
            blockHash: log.blockHash,
            shares,
            sharesAfter: 0n,       // Fixed by recalculateAggregates
            totalSupplyAfter: 0n,  // Fixed by recalculateAggregates
            liquidityAfter: 0n,    // Fixed by recalculateAggregates
            sqrtPriceX96,
        };

        // 11. Create event with placeholder aggregates
        const createInput: CreateVaultLedgerEventInput = {
            previousId: null,
            timestamp: blockTimestamp,
            eventType,
            inputHash,
            tokenValue,
            rewards: [],
            deltaCostBasis: 0n,
            costBasisAfter: 0n,
            deltaPnl: 0n,
            pnlAfter: 0n,
            deltaCollectedYield: 0n,
            collectedYieldAfter: 0n,
            deltaRealizedCashflow: 0n,
            realizedCashflowAfter: 0n,
            config: ledgerConfig,
            state: ledgerState,
        };

        await this.create(createInput, tx);

        return {
            action: 'inserted',
            inputHash,
            eventDetail: { eventType, shares, tokenValue, blockTimestamp },
            ...(reorgDeletedEvents !== undefined && { reorgDeletedEvents }),
        };
    }

    // ============================================================================
    // PNL ENGINE
    // ============================================================================

    /**
     * Recalculate all running totals by processing events in chronological order.
     */
    async recalculateAggregates(
        isToken0Quote: boolean,
        tx?: PrismaTransactionClient,
    ): Promise<VaultLedgerAggregates> {
        const events = await this.findAll(tx);

        if (events.length === 0) {
            return { sharesAfter: 0n, costBasisAfter: 0n, realizedPnlAfter: 0n, collectedYieldAfter: 0n, realizedCashflowAfter: 0n };
        }

        // Sort chronologically (findAll returns newest first)
        UniswapV3VaultLedgerService.sortByBlockchainCoordinates(events);

        // Delete existing APR periods
        await this._aprService.deleteAllAprPeriods(tx);

        // Running totals
        let sharesAfter = 0n;
        let costBasisAfter = 0n;
        let pnlAfter = 0n;
        let collectedYieldAfter = 0n;
        let previousEventId: string | null = null;

        // APR period tracking
        let periodStartTimestamp: Date | null = null;
        let periodStartEventId: string | null = null;
        let periodCostBasisSnapshots: Array<{ timestamp: Date; costBasisAfter: bigint }> = [];
        let periodEventCount = 0;

        for (const event of events) {
            const state = event.typedState;
            const config = event.typedConfig;
            const sqrtPriceX96 = config.sqrtPriceX96;

            const previousShares = sharesAfter;
            const previousCostBasis = costBasisAfter;
            const previousPnl = pnlAfter;
            const previousCollectedYield = collectedYieldAfter;

            let deltaCostBasis = 0n;
            let deltaPnl = 0n;
            let deltaCollectedYield = 0n;

            switch (state.eventType) {
                case 'VAULT_COLLECT_YIELD': {
                    sharesAfter = previousShares;
                    costBasisAfter = previousCostBasis;
                    const feeValue = this.calculateTokenValue(
                        state.fee0, state.fee1, sqrtPriceX96, isToken0Quote,
                    );
                    deltaPnl = feeValue;
                    pnlAfter = previousPnl + deltaPnl;
                    deltaCollectedYield = feeValue;
                    collectedYieldAfter = previousCollectedYield + deltaCollectedYield;
                    break;
                }
                case 'VAULT_TRANSFER_IN': {
                    sharesAfter = previousShares + state.shares;
                    deltaCostBasis = event.tokenValue;
                    costBasisAfter = previousCostBasis + deltaCostBasis;
                    pnlAfter = previousPnl;
                    break;
                }
                case 'VAULT_TRANSFER_OUT': {
                    let proportionalCostBasis = 0n;
                    if (previousShares > 0n && state.shares > 0n) {
                        proportionalCostBasis = (state.shares * previousCostBasis) / previousShares;
                    }
                    sharesAfter = previousShares - state.shares;
                    deltaCostBasis = -proportionalCostBasis;
                    costBasisAfter = previousCostBasis + deltaCostBasis;
                    deltaPnl = event.tokenValue - proportionalCostBasis;
                    pnlAfter = previousPnl + deltaPnl;
                    break;
                }
            }

            // APR period tracking
            if (periodStartTimestamp === null) {
                periodStartTimestamp = event.timestamp;
                periodStartEventId = event.id;
            }
            periodCostBasisSnapshots.push({ timestamp: event.timestamp, costBasisAfter });
            periodEventCount++;

            // VAULT_COLLECT_YIELD ends the current APR period
            if (state.eventType === 'VAULT_COLLECT_YIELD') {
                if (periodStartTimestamp && periodCostBasisSnapshots.length >= 2) {
                    try {
                        const timeWeightedCostBasis = calculateTimeWeightedCostBasis(periodCostBasisSnapshots);
                        const durationSeconds = calculateDurationSeconds(periodStartTimestamp, event.timestamp);
                        const aprBps = durationSeconds > 0 && timeWeightedCostBasis > 0n
                            ? calculateAprBps(deltaCollectedYield, timeWeightedCostBasis, durationSeconds)
                            : 0;

                        const aprPeriod: AprPeriodData = {
                            startEventId: periodStartEventId!,
                            endEventId: event.id,
                            startTimestamp: periodStartTimestamp,
                            endTimestamp: event.timestamp,
                            durationSeconds,
                            costBasis: timeWeightedCostBasis,
                            collectedYieldValue: deltaCollectedYield,
                            aprBps,
                            eventCount: periodEventCount,
                        };
                        await this._aprService.persistAprPeriod(aprPeriod, tx);
                    } catch (e) {
                        this.logger.warn({ error: e }, 'Skipping invalid APR period');
                    }
                }
                periodStartTimestamp = event.timestamp;
                periodStartEventId = event.id;
                periodCostBasisSnapshots = [{ timestamp: event.timestamp, costBasisAfter }];
                periodEventCount = 0;
            }

            // Update event in DB with corrected values
            await this.updateEventAggregates(
                event.id,
                config,
                {
                    previousId: previousEventId,
                    sharesAfter,
                    deltaCostBasis,
                    costBasisAfter,
                    deltaPnl,
                    pnlAfter,
                    deltaCollectedYield,
                    collectedYieldAfter,
                },
                tx,
            );

            previousEventId = event.id;
        }

        return { sharesAfter, costBasisAfter, realizedPnlAfter: pnlAfter, collectedYieldAfter, realizedCashflowAfter: 0n };
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    /**
     * Update a single event's running totals in the database.
     */
    private async updateEventAggregates(
        eventId: string,
        existingConfig: UniswapV3VaultLedgerEventConfig,
        updates: UpdateVaultEventAggregatesInput,
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        const db = tx ?? this.prisma;

        const updatedConfig: UniswapV3VaultLedgerEventConfig = {
            ...existingConfig,
            sharesAfter: updates.sharesAfter,
        };

        await db.positionLedgerEvent.update({
            where: { id: eventId },
            data: {
                previousId: updates.previousId,
                deltaCostBasis: updates.deltaCostBasis.toString(),
                costBasisAfter: updates.costBasisAfter.toString(),
                deltaPnl: updates.deltaPnl.toString(),
                pnlAfter: updates.pnlAfter.toString(),
                deltaCollectedYield: updates.deltaCollectedYield.toString(),
                collectedYieldAfter: updates.collectedYieldAfter.toString(),
                config: vaultLedgerEventConfigToJSON(updatedConfig) as object,
            },
        });
    }

    /**
     * Calculate total token value in quote token units.
     */
    private calculateTokenValue(
        amount0: bigint,
        amount1: bigint,
        sqrtPriceX96: bigint,
        isToken0Quote: boolean,
    ): bigint {
        if (isToken0Quote) {
            return amount0 + valueOfToken1AmountInToken0(amount1, sqrtPriceX96);
        } else {
            return valueOfToken0AmountInToken1(amount0, sqrtPriceX96) + amount1;
        }
    }
}
