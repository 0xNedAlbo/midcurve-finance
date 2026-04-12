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

import { decodeAbiParameters } from 'viem';
import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
    UniswapV3VaultPositionLedgerEvent,
    vaultLedgerEventConfigToJSON,
    vaultLedgerEventStateToJSON,
    valueOfToken0AmountInToken1,
    valueOfToken1AmountInToken0,
    calculatePositionValue,
    getTokenAmountsFromLiquidity,
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
    YIELD_COLLECTED: '0x18898ecacb8287585d905259ceebe4f692ca4a958d7e2c1383dc9e9f493a053f',
    TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const;

/**
 * Companion event signatures for Minted/Burned events.
 * Not processed as primary events — looked up from the same transaction
 * when a mint/burn Transfer is detected, to extract tokenAmounts.
 */
export const VAULT_COMPANION_SIGNATURES = {
    MINTED: '0x09a6b7fc897b2b2cb269f200c545ec63a2e2e2333c6c67a401474f3e769d2d5c',
    BURNED: '0x9c1f1198afd378491520e2f7dc5adff4ae935658c101093cf24dfce2ed379089',
} as const;

export type ValidVaultEventType = keyof typeof VAULT_EVENT_SIGNATURES;

/**
 * Vault position closer contract event signatures (topic0 values).
 * Used to decode companion events in close order transactions.
 */
export const CLOSER_EVENT_SIGNATURES = {
    ORDER_EXECUTED: '0x3b42dbda3381567ed7cf11ea8695c3f8928c814a5992dddbb42172cbc951d5d7',
    FEE_APPLIED: '0x084dea19ebac10547492fe21b6ed26d07ce133d2b1589cbea787e3872ec1ece1',
    SWAP_EXECUTED: '0xdd918ef080ed96250ca11bb10fb199f9634a2cb595e4d7dda0bde43879494421',
} as const;

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
    } else if (eventType === 'YIELD_COLLECTED') {
        // YieldCollected(user indexed, recipient indexed, ...) — match user (topic1)
        if (log.topics.length < 3) return { valid: false, reason: 'missing_topics' };
        const user = log.topics[1]?.toLowerCase();
        if (user !== userHex) {
            return { valid: false, reason: 'wrong_user' };
        }
    }

    return { valid: true, eventType };
}

// ============================================================================
// DECODING
// ============================================================================

export interface DecodedVaultYieldCollectedData {
    eventType: 'YIELD_COLLECTED';
    user: string;
    recipient: string;
    tokenAmounts: bigint[];
}

export interface DecodedVaultTransferData {
    eventType: 'TRANSFER';
    value: bigint;
}

export type DecodedVaultLogData =
    | DecodedVaultYieldCollectedData
    | DecodedVaultTransferData;

/**
 * Decode ABI-encoded log data for vault events.
 * Uses viem's decodeAbiParameters for dynamic array decoding (YieldCollected).
 */
export function decodeVaultLogData(
    eventType: ValidVaultEventType,
    data: string,
    topics: readonly string[],
): DecodedVaultLogData {
    const hex = data.startsWith('0x') ? data.slice(2) : data;

    switch (eventType) {
        case 'YIELD_COLLECTED': {
            // Indexed: user (topic1), recipient (topic2)
            // Data: (uint256[] tokenAmounts)
            const user = '0x' + (topics[1]?.slice(26) ?? '');
            const recipient = '0x' + (topics[2]?.slice(26) ?? '');
            const decoded = decodeAbiParameters(
                [{ name: 'tokenAmounts', type: 'uint256[]' }],
                `0x${hex}` as `0x${string}`,
            );
            return {
                eventType: 'YIELD_COLLECTED',
                user,
                recipient,
                tokenAmounts: [...decoded[0]],
            };
        }
        case 'TRANSFER': {
            // (uint256 value)
            const chunks = hex.match(/.{64}/g) || [];
            if (chunks.length < 1) throw new Error(`Invalid TRANSFER data: expected 1 chunk, got ${chunks.length}`);
            return {
                eventType: 'TRANSFER',
                value: BigInt('0x' + chunks[0]!),
            };
        }
    }
}

/**
 * Decode tokenAmounts from a companion Minted or Burned log.
 * Both events have the same data layout: (uint256 shares, uint256[] tokenAmounts).
 */
export function decodeMintBurnCompanionLog(log: VaultRawLogInput): bigint[] {
    const hex = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const decoded = decodeAbiParameters(
        [
            { name: 'shares', type: 'uint256' },
            { name: 'tokenAmounts', type: 'uint256[]' },
        ],
        `0x${hex}` as `0x${string}`,
    );
    return [...decoded[1]];
}

// ============================================================================
// CLOSER EVENT DECODING
// ============================================================================

export interface DecodedOrderExecutedData {
    vault: string;
    triggerMode: number;
    owner: string;
    payout: string;
    executionTick: number;
    sharesClosed: bigint;
    amount0Out: bigint;
    amount1Out: bigint;
}

export interface DecodedFeeAppliedData {
    vault: string;
    triggerMode: number;
    feeRecipient: string;
    feeBps: number;
    feeAmount0: bigint;
    feeAmount1: bigint;
}

export interface DecodedSwapExecutedData {
    vault: string;
    triggerMode: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOut: bigint;
}

/**
 * Decode an OrderExecuted event from the closer contract.
 * Indexed: vault (topic1), triggerMode (topic2), owner (topic3)
 * Data: (address payout, int24 executionTick, uint256 sharesClosed, uint256 amount0Out, uint256 amount1Out)
 */
export function decodeOrderExecutedLog(data: string, topics: readonly string[]): DecodedOrderExecutedData {
    const hex = data.startsWith('0x') ? data.slice(2) : data;
    const chunks = hex.match(/.{64}/g) || [];
    return {
        vault: '0x' + (topics[1]?.slice(26) ?? ''),
        triggerMode: Number(BigInt('0x' + (topics[2]?.slice(2) ?? '0'))),
        owner: '0x' + (topics[3]?.slice(26) ?? ''),
        payout: '0x' + (chunks[0]?.slice(24) ?? ''),
        executionTick: Number(BigInt.asIntN(24, BigInt('0x' + (chunks[1] ?? '0')))),
        sharesClosed: BigInt('0x' + (chunks[2] ?? '0')),
        amount0Out: BigInt('0x' + (chunks[3] ?? '0')),
        amount1Out: BigInt('0x' + (chunks[4] ?? '0')),
    };
}

/**
 * Decode a FeeApplied event from the closer contract.
 * Indexed: vault (topic1), triggerMode (topic2), feeRecipient (topic3)
 * Data: (uint16 feeBps, uint256 feeAmount0, uint256 feeAmount1)
 */
export function decodeFeeAppliedLog(data: string, topics: readonly string[]): DecodedFeeAppliedData {
    const hex = data.startsWith('0x') ? data.slice(2) : data;
    const chunks = hex.match(/.{64}/g) || [];
    return {
        vault: '0x' + (topics[1]?.slice(26) ?? ''),
        triggerMode: Number(BigInt('0x' + (topics[2]?.slice(2) ?? '0'))),
        feeRecipient: '0x' + (topics[3]?.slice(26) ?? ''),
        feeBps: Number(BigInt('0x' + (chunks[0] ?? '0'))),
        feeAmount0: BigInt('0x' + (chunks[1] ?? '0')),
        feeAmount1: BigInt('0x' + (chunks[2] ?? '0')),
    };
}

/**
 * Decode a SwapExecuted event from the closer contract.
 * Indexed: vault (topic1), triggerMode (topic2)
 * Data: (address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)
 */
export function decodeSwapExecutedLog(data: string, topics: readonly string[]): DecodedSwapExecutedData {
    const hex = data.startsWith('0x') ? data.slice(2) : data;
    const chunks = hex.match(/.{64}/g) || [];
    return {
        vault: '0x' + (topics[1]?.slice(26) ?? ''),
        triggerMode: Number(BigInt('0x' + (topics[2]?.slice(2) ?? '0'))),
        tokenIn: '0x' + (chunks[0]?.slice(24) ?? ''),
        tokenOut: '0x' + (chunks[1]?.slice(24) ?? ''),
        amountIn: BigInt('0x' + (chunks[2] ?? '0')),
        amountOut: BigInt('0x' + (chunks[3] ?? '0')),
    };
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
        closerAddress?: string,
        tx?: PrismaTransactionClient,
    ): Promise<VaultImportLogsResult> {
        const preImportAggregates = await this.recalculateAggregates(
            position.typedConfig.isToken0Quote,
            tx,
        );

        // Build a map of closer contract logs grouped by transaction hash
        // so processSingleLog can look up companion events for close order detection
        const closerLogsByTx = new Map<string, VaultRawLogInput[]>();
        if (closerAddress) {
            const closerAddrLower = closerAddress.toLowerCase();
            for (const log of logs) {
                if (log.address.toLowerCase() === closerAddrLower) {
                    const txHash = log.transactionHash.toLowerCase();
                    const existing = closerLogsByTx.get(txHash) ?? [];
                    existing.push(log);
                    closerLogsByTx.set(txHash, existing);
                }
            }
        }

        // Build a map of Minted/Burned companion logs grouped by transaction hash
        // so processSingleLog can extract tokenAmounts for mint/burn Transfer events
        const mintBurnLogsByTx = new Map<string, VaultRawLogInput[]>();
        const vaultAddrLower = position.typedConfig.vaultAddress.toLowerCase();
        for (const log of logs) {
            if (log.address.toLowerCase() !== vaultAddrLower) continue;
            const topic0 = log.topics[0]?.toLowerCase();
            if (topic0 === VAULT_COMPANION_SIGNATURES.MINTED.toLowerCase()
                || topic0 === VAULT_COMPANION_SIGNATURES.BURNED.toLowerCase()) {
                const txHash = log.transactionHash.toLowerCase();
                const existing = mintBurnLogsByTx.get(txHash) ?? [];
                existing.push(log);
                mintBurnLogsByTx.set(txHash, existing);
            }
        }

        const perLogResults: VaultSingleLogResult[] = [];
        const allDeletedEvents: UniswapV3VaultPositionLedgerEvent[] = [];

        for (const log of logs) {
            // Skip closer contract logs — they're only used as companion data
            if (closerAddress && log.address.toLowerCase() === closerAddress.toLowerCase()) {
                continue;
            }
            // Skip Minted/Burned companion logs — they're only used as companion data
            const topic0 = log.topics[0]?.toLowerCase();
            if (topic0 === VAULT_COMPANION_SIGNATURES.MINTED.toLowerCase()
                || topic0 === VAULT_COMPANION_SIGNATURES.BURNED.toLowerCase()) {
                continue;
            }

            const result = await this.processSingleLog(
                position,
                chainId,
                userAddress,
                log,
                poolPriceService,
                closerAddress,
                closerLogsByTx,
                mintBurnLogsByTx,
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
        closerAddress?: string,
        closerLogsByTx?: Map<string, VaultRawLogInput[]>,
        mintBurnLogsByTx?: Map<string, VaultRawLogInput[]>,
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
        const decoded = decodeVaultLogData(validation.eventType, log.data, log.topics);

        // 9. Determine event type + calculate tokenValue + build state
        let eventType: EventType;
        let tokenValue: bigint;
        let shares: bigint;
        let ledgerState: UniswapV3VaultLedgerEventState;

        const userHex = '0x' + userAddress.toLowerCase().slice(2).padStart(64, '0');

        if (decoded.eventType === 'YIELD_COLLECTED') {
            eventType = 'VAULT_COLLECT_YIELD';
            shares = 0n;
            const token0Amount = decoded.tokenAmounts[0] ?? 0n;
            const token1Amount = decoded.tokenAmounts[1] ?? 0n;
            tokenValue = this.calculateTokenValue(token0Amount, token1Amount, sqrtPriceX96, position.typedConfig.isToken0Quote);
            ledgerState = {
                eventType: 'VAULT_COLLECT_YIELD',
                user: decoded.user,
                recipient: decoded.recipient,
                poolPrice: sqrtPriceX96,
                tokenAmounts: [token0Amount, token1Amount],
            };
        } else {
            // TRANSFER — classify by from/to addresses:
            //   from 0x0 → owner = VAULT_MINT
            //   from owner → 0x0 = VAULT_BURN
            //   from owner → other = VAULT_TRANSFER_OUT
            //   from other → owner = VAULT_TRANSFER_IN
            const ZERO_TOPIC = '0x' + '0'.repeat(64);
            const from = log.topics[1]?.toLowerCase();
            const to = log.topics[2]?.toLowerCase();
            shares = decoded.value;

            if (from === ZERO_TOPIC && to === userHex) {
                // Mint: from 0x0 → owner
                // Look for companion Minted event in same tx for actual tokenAmounts
                const tokenAmounts = this.extractCompanionTokenAmounts(
                    mintBurnLogsByTx, log.transactionHash, VAULT_COMPANION_SIGNATURES.MINTED,
                );
                eventType = 'VAULT_MINT';
                if (tokenAmounts) {
                    tokenValue = this.calculateTokenValue(tokenAmounts[0]!, tokenAmounts[1]!, sqrtPriceX96, position.typedConfig.isToken0Quote);
                } else {
                    // Fallback: initial vault creation has no Minted event — compute from shares
                    tokenValue = calculatePositionValue(
                        decoded.value, sqrtPriceX96,
                        position.typedConfig.tickLower, position.typedConfig.tickUpper,
                        !position.typedConfig.isToken0Quote,
                    );
                }
                let mintTokenAmounts = tokenAmounts;
                if (!mintTokenAmounts) {
                    // Initial vault creation: compute from shares (== liquidity) at event price
                    const computed = getTokenAmountsFromLiquidity(
                        decoded.value, sqrtPriceX96,
                        position.typedConfig.tickLower, position.typedConfig.tickUpper,
                    );
                    mintTokenAmounts = [computed.token0Amount, computed.token1Amount];
                }
                ledgerState = {
                    eventType: 'VAULT_MINT',
                    shares: decoded.value,
                    minter: '0x0000000000000000000000000000000000000000',
                    recipient: userAddress,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: mintTokenAmounts,
                };
            } else if (from === userHex && to === ZERO_TOPIC) {
                // Burn: from owner → 0x0
                const tokenAmounts = this.extractCompanionTokenAmounts(
                    mintBurnLogsByTx, log.transactionHash, VAULT_COMPANION_SIGNATURES.BURNED,
                );
                eventType = 'VAULT_BURN';
                if (tokenAmounts) {
                    tokenValue = this.calculateTokenValue(tokenAmounts[0]!, tokenAmounts[1]!, sqrtPriceX96, position.typedConfig.isToken0Quote);
                } else {
                    tokenValue = calculatePositionValue(
                        decoded.value, sqrtPriceX96,
                        position.typedConfig.tickLower, position.typedConfig.tickUpper,
                        !position.typedConfig.isToken0Quote,
                    );
                }
                let burnTokenAmounts = tokenAmounts;
                if (!burnTokenAmounts) {
                    const computed = getTokenAmountsFromLiquidity(
                        decoded.value, sqrtPriceX96,
                        position.typedConfig.tickLower, position.typedConfig.tickUpper,
                    );
                    burnTokenAmounts = [computed.token0Amount, computed.token1Amount];
                }
                ledgerState = {
                    eventType: 'VAULT_BURN',
                    shares: decoded.value,
                    burner: userAddress,
                    recipient: userAddress,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: burnTokenAmounts,
                };
            } else if (from === userHex) {
                // Transfer OUT: from owner → another address
                const toAddress = '0x' + to!.slice(26);
                tokenValue = calculatePositionValue(
                    decoded.value, sqrtPriceX96,
                    position.typedConfig.tickLower, position.typedConfig.tickUpper,
                    !position.typedConfig.isToken0Quote,
                );

                // Check if the transfer is to the closer contract (close order execution)
                const isCloseOrder = closerAddress
                    && toAddress.toLowerCase() === closerAddress.toLowerCase()
                    && closerLogsByTx;

                if (isCloseOrder) {
                    // Composite close order event — look up companion events from the same tx
                    const companionLogs = closerLogsByTx.get(log.transactionHash.toLowerCase()) ?? [];
                    const { eventType: closeEventType, tokenValue: closeTokenValue, ledgerState: closeLedgerState } =
                        this.buildCloseOrderEvent(
                            decoded.value, sqrtPriceX96, companionLogs, position.typedConfig.isToken0Quote,
                        );
                    eventType = closeEventType;
                    tokenValue = closeTokenValue;
                    ledgerState = closeLedgerState;
                } else {
                    eventType = 'VAULT_TRANSFER_OUT';
                    ledgerState = {
                        eventType: 'VAULT_TRANSFER_OUT',
                        shares: decoded.value,
                        to: toAddress,
                        poolPrice: sqrtPriceX96,
                        tokenAmounts: [0n, 0n],
                    };
                }
            } else {
                // Transfer IN: from another address → owner
                eventType = 'VAULT_TRANSFER_IN';
                tokenValue = calculatePositionValue(
                    decoded.value, sqrtPriceX96,
                    position.typedConfig.tickLower, position.typedConfig.tickUpper,
                    !position.typedConfig.isToken0Quote,
                );
                const fromAddress = '0x' + from!.slice(26);
                ledgerState = {
                    eventType: 'VAULT_TRANSFER_IN',
                    shares: decoded.value,
                    from: fromAddress,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: [0n, 0n],
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
                        state.tokenAmounts[0] ?? 0n, state.tokenAmounts[1] ?? 0n, sqrtPriceX96, isToken0Quote,
                    );
                    deltaPnl = feeValue;
                    pnlAfter = previousPnl + deltaPnl;
                    deltaCollectedYield = feeValue;
                    collectedYieldAfter = previousCollectedYield + deltaCollectedYield;
                    break;
                }
                case 'VAULT_MINT':
                case 'VAULT_TRANSFER_IN': {
                    sharesAfter = previousShares + state.shares;
                    deltaCostBasis = event.tokenValue;
                    costBasisAfter = previousCostBasis + deltaCostBasis;
                    pnlAfter = previousPnl;
                    break;
                }
                case 'VAULT_BURN':
                case 'VAULT_TRANSFER_OUT':
                case 'VAULT_CLOSE_ORDER_EXECUTED': {
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

    /**
     * Extract tokenAmounts from a companion Minted or Burned log in the same transaction.
     * Returns null if no companion event is found (e.g. initial vault creation).
     */
    private extractCompanionTokenAmounts(
        mintBurnLogsByTx: Map<string, VaultRawLogInput[]> | undefined,
        transactionHash: string,
        expectedSignature: string,
    ): [bigint, bigint] | null {
        if (!mintBurnLogsByTx) return null;
        const companions = mintBurnLogsByTx.get(transactionHash.toLowerCase()) ?? [];
        const match = companions.find(
            (l) => l.topics[0]?.toLowerCase() === expectedSignature.toLowerCase(),
        );
        if (!match) return null;
        const amounts = decodeMintBurnCompanionLog(match);
        return [amounts[0] ?? 0n, amounts[1] ?? 0n];
    }

    /**
     * Build a composite VAULT_CLOSE_ORDER_EXECUTED event from companion closer contract logs.
     * Correlates OrderExecuted + FeeApplied + SwapExecuted from the same transaction
     * to compute the actual execution proceeds.
     */
    private buildCloseOrderEvent(
        shares: bigint,
        sqrtPriceX96: bigint,
        companionLogs: VaultRawLogInput[],
        isToken0Quote: boolean,
    ): { eventType: EventType; tokenValue: bigint; ledgerState: UniswapV3VaultLedgerEventState } {
        // Decode companion events
        let orderExecuted: DecodedOrderExecutedData | null = null;
        let feeApplied: DecodedFeeAppliedData | null = null;
        const swapsExecuted: DecodedSwapExecutedData[] = [];

        for (const cLog of companionLogs) {
            const topic0 = cLog.topics[0]?.toLowerCase();
            if (topic0 === CLOSER_EVENT_SIGNATURES.ORDER_EXECUTED.toLowerCase()) {
                orderExecuted = decodeOrderExecutedLog(cLog.data, cLog.topics);
            } else if (topic0 === CLOSER_EVENT_SIGNATURES.FEE_APPLIED.toLowerCase()) {
                feeApplied = decodeFeeAppliedLog(cLog.data, cLog.topics);
            } else if (topic0 === CLOSER_EVENT_SIGNATURES.SWAP_EXECUTED.toLowerCase()) {
                swapsExecuted.push(decodeSwapExecutedLog(cLog.data, cLog.topics));
            }
        }

        // Extract execution data (fallback to zeros if OrderExecuted not found)
        const amount0Out = orderExecuted?.amount0Out ?? 0n;
        const amount1Out = orderExecuted?.amount1Out ?? 0n;
        const payout = orderExecuted?.payout ?? '';
        const executionTick = orderExecuted?.executionTick ?? 0;
        const feeAmount0 = feeApplied?.feeAmount0 ?? 0n;
        const feeAmount1 = feeApplied?.feeAmount1 ?? 0n;
        const feeBps = feeApplied?.feeBps ?? 0;

        // Aggregate swap amounts across all phases
        let totalSwapAmountIn = 0n;
        let totalSwapAmountOut = 0n;
        for (const swap of swapsExecuted) {
            totalSwapAmountIn += swap.amountIn;
            totalSwapAmountOut += swap.amountOut;
        }

        // Calculate final proceeds: burn output - fees, then apply swap
        const afterFee0 = amount0Out - feeAmount0;
        const afterFee1 = amount1Out - feeAmount1;

        let finalAmount0 = afterFee0;
        let finalAmount1 = afterFee1;

        // Apply swap: the swap converts one token entirely into the other.
        // Determine direction from the first SwapExecuted event's tokenIn.
        if (swapsExecuted.length > 0) {
            // We need to identify which token is token0 vs token1.
            // The vault emits OrderExecuted with the vault address indexed.
            // SwapExecuted has tokenIn/tokenOut addresses — compare with known token addresses
            // from the earlier burn logs to determine direction.
            // Simpler: if tokenIn was the same token that had afterFee > 0 on the token0 side,
            // it's TOKEN0_TO_1; otherwise TOKEN1_TO_0.
            // Since the contract swaps ALL of one side, the swapped side goes to 0.
            const swapInputIsToken0 = afterFee0 > 0n && totalSwapAmountIn > 0n && afterFee0 >= totalSwapAmountIn;

            if (swapInputIsToken0) {
                // TOKEN0_TO_1: all token0 swapped, token1 receives swap output
                finalAmount0 = afterFee0 - totalSwapAmountIn;
                finalAmount1 = afterFee1 + totalSwapAmountOut;
            } else {
                // TOKEN1_TO_0: all token1 swapped, token0 receives swap output
                finalAmount1 = afterFee1 - totalSwapAmountIn;
                finalAmount0 = afterFee0 + totalSwapAmountOut;
            }
        }

        // tokenValue based on actual final proceeds
        const tokenValue = this.calculateTokenValue(finalAmount0, finalAmount1, sqrtPriceX96, isToken0Quote);

        const ledgerState: UniswapV3VaultLedgerEventState = {
            eventType: 'VAULT_CLOSE_ORDER_EXECUTED',
            shares,
            payout,
            executionTick,
            amount0Out,
            amount1Out,
            feeAmount0,
            feeAmount1,
            feeBps,
            swapAmountIn: totalSwapAmountIn,
            swapAmountOut: totalSwapAmountOut,
            finalAmount0,
            finalAmount1,
            poolPrice: sqrtPriceX96,
            tokenAmounts: [finalAmount0, finalAmount1],
        };

        return { eventType: 'VAULT_CLOSE_ORDER_EXECUTED', tokenValue, ledgerState };
    }
}
