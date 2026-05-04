/**
 * UniswapV3 Staking Ledger Service
 *
 * Manages ledger events for UniswapV3StakingVault positions.
 *
 * Event mapping (per SPEC-0003b §6.3):
 * - Stake (initial or top-up) → STAKING_DEPOSIT
 * - Swap → STAKING_DISPOSE (executor settlement)
 * - FlashCloseInitiated + same-tx auto-drained Unstake + ClaimRewards →
 *   single synthesized STAKING_DISPOSE (source='flashClose')
 * - YieldTargetSet → STAKING_YIELD_TARGET_SET (marker, no financial impact)
 * - PartialUnstakeBpsSet → STAKING_PENDING_BPS_SET (marker, no financial impact)
 * - Standalone Unstake / ClaimRewards (owner-driven drain, NOT in a flashClose tx)
 *   → suppressed (buffers don't affect cost basis directly)
 *
 * Recalculation follows Model A (per philosophy.md):
 * - Yield is NEVER added to deltaPnl; it goes to deltaCollectedYield only.
 * - deltaPnl on disposal = principalQuoteValue − proportionalCostBasis.
 *   This differs from UniswapV3LedgerService where COLLECT events add fees to PnL.
 */

import { decodeAbiParameters } from 'viem';
import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
    UniswapV3StakingPositionLedgerEvent,
    stakingLedgerEventConfigToJSON,
    stakingLedgerEventStateToJSON,
    valueOfToken0AmountInToken1,
    valueOfToken1AmountInToken0,
} from '@midcurve/shared';
import type {
    UniswapV3StakingPositionLedgerEventRow,
    UniswapV3StakingLedgerEventConfig,
    UniswapV3StakingLedgerEventState,
    StakingState,
    EventType,
    Reward,
} from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';

// ============================================================================
// EVENT SIGNATURES
// ============================================================================

/**
 * Topic0 (event signature hash) for each UniswapV3StakingVault event.
 * Computed once via `keccak256(toBytes(<solidity-signature>))`.
 */
export const STAKING_VAULT_EVENT_SIGNATURES = {
    STAKE:                   '0x2720efa4b2dd4f3f8a347da3cbd290a522e9432da9072c5b8e6300496fdde282',
    YIELD_TARGET_SET:        '0x8157141975dedf58854297da6355d32a1aa83c4167c66664dac07c9a74c2d27a',
    PARTIAL_UNSTAKE_BPS_SET: '0x991a39dd3212a3790cc04f8694ea6724f3053f36e0b3949c3f1d694a6b0de739',
    SWAP:                    '0xa1f9d84f8238f8ae4b568ee1ae8a42dbaf3aad54ca2fc6e6b50d4b9a75b259c7',
    UNSTAKE:                 '0xf960dbf9e5d0682f7a298ed974e33a28b4464914b7a2bfac12ae419a9afeb280',
    CLAIM_REWARDS:           '0x674a8930d4166ce2352c3dc1e9ff633595db479f71f3741270a0a73a52cb7b0f',
    FLASH_CLOSE_INITIATED:   '0x9d0df5b0f16aa34c89a9e410e837bcf07e564658481be063a50b847654b62382',
} as const;

export type ValidStakingEventType = keyof typeof STAKING_VAULT_EVENT_SIGNATURES;

// ============================================================================
// RAW LOG TYPES
// ============================================================================

/**
 * Optional pre-fetched chain state for events that need it.
 *
 * Subscribers (PR2) populate these via NFPM/vault contract reads.
 * Unit tests inject them directly into fixtures.
 *
 * Required fields by event type:
 * - Stake: `vaultStateBefore`, `liquidityAfter` (all fields below required for top-up disambiguation)
 * - Swap: `stakedBaseBefore`, `stakedQuoteBefore`, `rewardBufferBaseDelta`,
 *         `rewardBufferQuoteDelta`, `liquidityAfter`
 * - FlashCloseInitiated: `liquidityAfter` (principal/yield are derived from
 *   the same-tx Unstake/ClaimRewards events)
 * - All marker events / standalone Unstake / ClaimRewards: none
 */
export interface StakingLogChainContext {
    /** vault.state() at blockNumber - 1 (for Stake disambiguation) */
    vaultStateBefore?: StakingState;
    /** NFPM.positions(tokenId).liquidity at blockNumber - 1 (initial-stake anchor only) */
    liquidityBefore?: bigint;
    /** NFPM.positions(tokenId).liquidity at blockNumber (post-event) */
    liquidityAfter?: bigint;
    /** vault.stakedBase() at blockNumber - 1 */
    stakedBaseBefore?: bigint;
    /** vault.stakedQuote() at blockNumber - 1 */
    stakedQuoteBefore?: bigint;
    /** rewardBuffer base delta (after - before, for Swap events) */
    rewardBufferBaseDelta?: bigint;
    /** rewardBuffer quote delta (after - before, for Swap events) */
    rewardBufferQuoteDelta?: bigint;
}

/**
 * Raw log + optional pre-fetched chain context.
 * Compatible with viem Log shape; chainContext is filled in by the subscriber.
 */
export interface StakingRawLogInput {
    address: string;
    topics: readonly string[];
    data: string;
    blockNumber: string | bigint;
    blockHash: string;
    transactionHash: string;
    transactionIndex: string | number;
    logIndex: string | number;
    removed?: boolean;
    chainContext?: StakingLogChainContext;
}

// ============================================================================
// VALIDATION
// ============================================================================

export type ValidateStakingEventResult =
    | { valid: true; eventType: ValidStakingEventType }
    | { valid: false; reason: 'wrong_contract' | 'unknown_event' | 'missing_topics' | 'wrong_owner' };

/**
 * Validate a raw staking-vault event log against the expected vault and owner.
 *
 * Owner-indexed events (Stake / YieldTargetSet / PartialUnstakeBpsSet / Unstake /
 * ClaimRewards / FlashCloseInitiated) check `topics[1] === ownerAddress`.
 * The Swap event has the executor in topics[1], so no owner check is performed.
 */
export function validateStakingEvent(
    vaultAddress: string,
    ownerAddress: string,
    log: StakingRawLogInput,
): ValidateStakingEventResult {
    if (log.address.toLowerCase() !== vaultAddress.toLowerCase()) {
        return { valid: false, reason: 'wrong_contract' };
    }

    if (!log.topics || log.topics.length < 1) {
        return { valid: false, reason: 'missing_topics' };
    }

    const topic0 = log.topics[0]?.toLowerCase();
    let eventType: ValidStakingEventType | null = null;
    for (const [type, signature] of Object.entries(STAKING_VAULT_EVENT_SIGNATURES)) {
        if (topic0 === signature.toLowerCase()) {
            eventType = type as ValidStakingEventType;
            break;
        }
    }
    if (!eventType) {
        return { valid: false, reason: 'unknown_event' };
    }

    if (eventType === 'SWAP') {
        // Executor-indexed; no owner check.
        if (log.topics.length < 2) return { valid: false, reason: 'missing_topics' };
        return { valid: true, eventType };
    }

    // Owner-indexed events: topic[1] must match ownerAddress.
    if (log.topics.length < 2) return { valid: false, reason: 'missing_topics' };
    const ownerHex = '0x' + ownerAddress.toLowerCase().slice(2).padStart(64, '0');
    if (log.topics[1]?.toLowerCase() !== ownerHex) {
        return { valid: false, reason: 'wrong_owner' };
    }

    return { valid: true, eventType };
}

// ============================================================================
// DECODING
// ============================================================================

export interface DecodedStakeData {
    eventType: 'STAKE';
    owner: string;
    base: bigint;
    quote: bigint;
    yieldTarget: bigint;
    tokenId: bigint;
}

export interface DecodedYieldTargetSetData {
    eventType: 'YIELD_TARGET_SET';
    owner: string;
    oldTarget: bigint;
    newTarget: bigint;
}

export interface DecodedPartialUnstakeBpsSetData {
    eventType: 'PARTIAL_UNSTAKE_BPS_SET';
    owner: string;
    oldBps: number;
    newBps: number;
}

export interface DecodedSwapData {
    eventType: 'SWAP';
    executor: string;
    tokenIn: string;
    amountIn: bigint;
    tokenOut: string;
    amountOut: bigint;
    effectiveBps: number;
}

export interface DecodedUnstakeData {
    eventType: 'UNSTAKE';
    owner: string;
    base: bigint;
    quote: bigint;
}

export interface DecodedClaimRewardsData {
    eventType: 'CLAIM_REWARDS';
    owner: string;
    baseAmount: bigint;
    quoteAmount: bigint;
}

export interface DecodedFlashCloseInitiatedData {
    eventType: 'FLASH_CLOSE_INITIATED';
    owner: string;
    bps: number;
    callbackTarget: string;
    data: string;
}

export type DecodedStakingLogData =
    | DecodedStakeData
    | DecodedYieldTargetSetData
    | DecodedPartialUnstakeBpsSetData
    | DecodedSwapData
    | DecodedUnstakeData
    | DecodedClaimRewardsData
    | DecodedFlashCloseInitiatedData;

function topicToAddress(topic: string | undefined): string {
    return '0x' + (topic?.slice(26) ?? '');
}

/**
 * Decode the ABI-encoded data + indexed topics for a staking-vault event.
 */
export function decodeStakingLogData(
    eventType: ValidStakingEventType,
    data: string,
    topics: readonly string[],
): DecodedStakingLogData {
    const dataHex = (data.startsWith('0x') ? data.slice(2) : data);
    switch (eventType) {
        case 'STAKE': {
            // Stake(address indexed owner, uint256 base, uint256 quote, uint256 yieldTarget, uint256 tokenId)
            const owner = topicToAddress(topics[1]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'base', type: 'uint256' },
                    { name: 'quote', type: 'uint256' },
                    { name: 'yieldTarget', type: 'uint256' },
                    { name: 'tokenId', type: 'uint256' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'STAKE',
                owner,
                base: decoded[0],
                quote: decoded[1],
                yieldTarget: decoded[2],
                tokenId: decoded[3],
            };
        }
        case 'YIELD_TARGET_SET': {
            // YieldTargetSet(address indexed owner, uint256 oldTarget, uint256 newTarget)
            const owner = topicToAddress(topics[1]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'oldTarget', type: 'uint256' },
                    { name: 'newTarget', type: 'uint256' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'YIELD_TARGET_SET',
                owner,
                oldTarget: decoded[0],
                newTarget: decoded[1],
            };
        }
        case 'PARTIAL_UNSTAKE_BPS_SET': {
            // PartialUnstakeBpsSet(address indexed owner, uint16 oldBps, uint16 newBps)
            const owner = topicToAddress(topics[1]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'oldBps', type: 'uint16' },
                    { name: 'newBps', type: 'uint16' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'PARTIAL_UNSTAKE_BPS_SET',
                owner,
                oldBps: Number(decoded[0]),
                newBps: Number(decoded[1]),
            };
        }
        case 'SWAP': {
            // Swap(address indexed executor, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, uint16 effectiveBps)
            const executor = topicToAddress(topics[1]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'tokenIn', type: 'address' },
                    { name: 'amountIn', type: 'uint256' },
                    { name: 'tokenOut', type: 'address' },
                    { name: 'amountOut', type: 'uint256' },
                    { name: 'effectiveBps', type: 'uint16' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'SWAP',
                executor,
                tokenIn: decoded[0],
                amountIn: decoded[1],
                tokenOut: decoded[2],
                amountOut: decoded[3],
                effectiveBps: Number(decoded[4]),
            };
        }
        case 'UNSTAKE': {
            // Unstake(address indexed owner, uint256 base, uint256 quote)
            const owner = topicToAddress(topics[1]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'base', type: 'uint256' },
                    { name: 'quote', type: 'uint256' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'UNSTAKE',
                owner,
                base: decoded[0],
                quote: decoded[1],
            };
        }
        case 'CLAIM_REWARDS': {
            // ClaimRewards(address indexed owner, uint256 baseAmount, uint256 quoteAmount)
            const owner = topicToAddress(topics[1]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'baseAmount', type: 'uint256' },
                    { name: 'quoteAmount', type: 'uint256' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'CLAIM_REWARDS',
                owner,
                baseAmount: decoded[0],
                quoteAmount: decoded[1],
            };
        }
        case 'FLASH_CLOSE_INITIATED': {
            // FlashCloseInitiated(address indexed owner, uint16 bps, address indexed callbackTarget, bytes data)
            const owner = topicToAddress(topics[1]);
            const callbackTarget = topicToAddress(topics[2]);
            const decoded = decodeAbiParameters(
                [
                    { name: 'bps', type: 'uint16' },
                    { name: 'data', type: 'bytes' },
                ],
                `0x${dataHex}` as `0x${string}`,
            );
            return {
                eventType: 'FLASH_CLOSE_INITIATED',
                owner,
                bps: Number(decoded[0]),
                callbackTarget,
                data: decoded[1],
            };
        }
    }
}

// ============================================================================
// CREATE INPUT
// ============================================================================

export interface CreateStakingLedgerEventInput {
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
    config: UniswapV3StakingLedgerEventConfig;
    state: UniswapV3StakingLedgerEventState;
}

// ============================================================================
// AGGREGATES
// ============================================================================

export interface StakingLedgerAggregates {
    liquidityAfter: bigint;
    costBasisAfter: bigint;
    realizedPnlAfter: bigint;
    collectedYieldAfter: bigint;
    realizedCashflowAfter: bigint;
}

// ============================================================================
// IMPORT RESULT
// ============================================================================

export type StakingSingleLogResult =
    | {
          action: 'inserted';
          inputHash: string;
          eventDetail: {
              eventType: EventType;
              tokenValue: bigint;
              blockTimestamp: Date;
          };
          reorgDeletedEvents?: UniswapV3StakingPositionLedgerEvent[];
      }
    | { action: 'removed'; inputHash: string; deletedEvents: UniswapV3StakingPositionLedgerEvent[]; blockHash: string }
    | { action: 'skipped'; reason: 'already_exists' | 'invalid_event' | 'folded_into_flash_close' | 'standalone_drain' };

export interface StakingImportLogsResult {
    perLogResults: StakingSingleLogResult[];
    allDeletedEvents: UniswapV3StakingPositionLedgerEvent[];
    preImportAggregates: StakingLedgerAggregates;
    postImportAggregates: StakingLedgerAggregates;
}

// ============================================================================
// UPDATE AGGREGATES INPUT
// ============================================================================

interface UpdateStakingEventAggregatesInput {
    previousId: string | null;
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

export interface UniswapV3StakingLedgerServiceConfig {
    positionId: string;
}

export interface UniswapV3StakingLedgerServiceDependencies {
    prisma?: PrismaClient;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3StakingLedgerService {
    private readonly prisma: PrismaClient;
    private readonly positionId: string;
    private readonly protocol = 'uniswapv3-staking' as const;
    private readonly logger: ServiceLogger;

    constructor(
        config: UniswapV3StakingLedgerServiceConfig,
        deps: UniswapV3StakingLedgerServiceDependencies = {},
    ) {
        this.positionId = config.positionId;
        this.prisma = deps.prisma ?? prismaClient;
        this.logger = createServiceLogger('uniswapv3-staking-ledger');
    }

    // ============================================================================
    // STATIC HELPERS
    // ============================================================================

    /**
     * Deterministic, reorg-safe inputHash for dedup.
     * Format: `uniswapv3-staking/{chainId}/{txHash}/{blockHash}/{logIndex}`
     */
    static createHash(
        chainId: number,
        txHash: string,
        blockHash: string,
        logIndex: number,
    ): string {
        return `uniswapv3-staking/${chainId}/${txHash}/${blockHash}/${logIndex}`;
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
    ): Promise<UniswapV3StakingPositionLedgerEvent[]> {
        const db = tx ?? this.prisma;
        const results = await db.positionLedgerEvent.findMany({
            where: {
                positionId: this.positionId,
                config: { path: ['txHash'], equals: txHash },
            },
        });
        return results.map((r) =>
            UniswapV3StakingPositionLedgerEvent.fromDB(
                r as unknown as UniswapV3StakingPositionLedgerEventRow,
            ),
        );
    }

    async findAll(tx?: PrismaTransactionClient): Promise<UniswapV3StakingPositionLedgerEvent[]> {
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
        `;
        return results.map((r) =>
            UniswapV3StakingPositionLedgerEvent.fromDB(
                r as unknown as UniswapV3StakingPositionLedgerEventRow,
            ),
        );
    }

    async findLast(tx?: PrismaTransactionClient): Promise<UniswapV3StakingPositionLedgerEvent | null> {
        const db = tx ?? this.prisma;
        const results = await db.$queryRaw<unknown[]>`
            SELECT * FROM position_ledger_events
            WHERE "positionId" = ${this.positionId}
            ORDER BY (config->>'blockNumber')::BIGINT DESC,
                     (config->>'logIndex')::INTEGER DESC
            LIMIT 1
        `;
        if (results.length === 0) return null;
        return UniswapV3StakingPositionLedgerEvent.fromDB(
            results[0] as unknown as UniswapV3StakingPositionLedgerEventRow,
        );
    }

    // ============================================================================
    // CRUD METHODS
    // ============================================================================

    async create(
        input: CreateStakingLedgerEventInput,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPositionLedgerEvent> {
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
                config: stakingLedgerEventConfigToJSON(input.config) as object,
                state: stakingLedgerEventStateToJSON(input.state) as object,
            },
        });
        return UniswapV3StakingPositionLedgerEvent.fromDB(
            result as unknown as UniswapV3StakingPositionLedgerEventRow,
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
    ): Promise<UniswapV3StakingPositionLedgerEvent[]> {
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
            UniswapV3StakingPositionLedgerEvent.fromDB(
                r as unknown as UniswapV3StakingPositionLedgerEventRow,
            ),
        );
    }

    // ============================================================================
    // IMPORT ORCHESTRATOR
    // ============================================================================

    /**
     * Import raw blockchain logs and recalculate all aggregates.
     *
     * Two-pass:
     * 1. Insert events with placeholder zeros for running totals.
     * 2. `recalculateAggregates` rebuilds all running totals chronologically.
     *
     * FlashClose composition is handled here: same-tx
     * `FlashCloseInitiated + Unstake + ClaimRewards` are folded into a single
     * synthesized `STAKING_DISPOSE` event keyed on the FlashCloseInitiated log.
     */
    async importLogsForPosition(
        position: { typedConfig: { isToken0Quote: boolean; vaultAddress: string; poolAddress: string } },
        chainId: number,
        ownerAddress: string,
        logs: StakingRawLogInput[],
        poolPriceService: UniswapV3PoolPriceService,
        tx?: PrismaTransactionClient,
    ): Promise<StakingImportLogsResult> {
        const preImportAggregates = await this.recalculateAggregates(
            position.typedConfig.isToken0Quote,
            tx,
        );

        const vaultAddrLower = position.typedConfig.vaultAddress.toLowerCase();

        // Collect FlashClose-tx companion events keyed by txHash for composition.
        const flashCloseTxHashes = new Set<string>();
        const unstakeByTx = new Map<string, StakingRawLogInput>();
        const claimRewardsByTx = new Map<string, StakingRawLogInput>();
        for (const log of logs) {
            if (log.address.toLowerCase() !== vaultAddrLower) continue;
            const topic0 = log.topics[0]?.toLowerCase();
            const txHash = log.transactionHash.toLowerCase();
            if (topic0 === STAKING_VAULT_EVENT_SIGNATURES.FLASH_CLOSE_INITIATED.toLowerCase()) {
                flashCloseTxHashes.add(txHash);
            } else if (topic0 === STAKING_VAULT_EVENT_SIGNATURES.UNSTAKE.toLowerCase()) {
                unstakeByTx.set(txHash, log);
            } else if (topic0 === STAKING_VAULT_EVENT_SIGNATURES.CLAIM_REWARDS.toLowerCase()) {
                claimRewardsByTx.set(txHash, log);
            }
        }

        const perLogResults: StakingSingleLogResult[] = [];
        const allDeletedEvents: UniswapV3StakingPositionLedgerEvent[] = [];

        for (const log of logs) {
            const result = await this.processSingleLog(
                position, chainId, ownerAddress, log, poolPriceService,
                flashCloseTxHashes, unstakeByTx, claimRewardsByTx,
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
        position: { typedConfig: { isToken0Quote: boolean; vaultAddress: string; poolAddress: string } },
        chainId: number,
        ownerAddress: string,
        log: StakingRawLogInput,
        poolPriceService: UniswapV3PoolPriceService,
        flashCloseTxHashes: Set<string>,
        unstakeByTx: Map<string, StakingRawLogInput>,
        claimRewardsByTx: Map<string, StakingRawLogInput>,
        tx?: PrismaTransactionClient,
    ): Promise<StakingSingleLogResult> {
        // 1. Validate
        const validation = validateStakingEvent(
            position.typedConfig.vaultAddress, ownerAddress, log,
        );
        if (!validation.valid) {
            this.logger.debug({ reason: validation.reason }, 'Invalid staking event skipped');
            return { action: 'skipped', reason: 'invalid_event' };
        }

        const txHash = log.transactionHash.toLowerCase();
        const txIsFlashClose = flashCloseTxHashes.has(txHash);

        // 2. Suppress UNSTAKE / CLAIM_REWARDS:
        //    - In flashClose tx: folded into the FlashCloseInitiated -> STAKING_DISPOSE event.
        //    - Standalone (owner-driven drain): no ledger impact (cost-basis was already
        //      booked at the prior Swap/FlashClose event; drains only move buffer balances
        //      to the owner wallet).
        if (validation.eventType === 'UNSTAKE' || validation.eventType === 'CLAIM_REWARDS') {
            return {
                action: 'skipped',
                reason: txIsFlashClose ? 'folded_into_flash_close' : 'standalone_drain',
            };
        }

        // 3. Parse numeric coordinates
        const logIndex = typeof log.logIndex === 'string'
            ? parseInt(log.logIndex, log.logIndex.startsWith('0x') ? 16 : 10)
            : log.logIndex;
        const txIndex = typeof log.transactionIndex === 'string'
            ? parseInt(log.transactionIndex, log.transactionIndex.startsWith('0x') ? 16 : 10)
            : log.transactionIndex;
        const blockNumber = typeof log.blockNumber === 'string'
            ? BigInt(log.blockNumber)
            : log.blockNumber;

        // 4. inputHash
        const inputHash = UniswapV3StakingLedgerService.createHash(
            chainId, log.transactionHash, log.blockHash, logIndex,
        );

        // 5. Active reorg
        if (log.removed) {
            const deletedEvents = await this.deleteAllByBlockHash(log.blockHash, tx);
            if (deletedEvents.length > 0) {
                this.logger.info(
                    { blockHash: log.blockHash, deletedCount: deletedEvents.length },
                    'Staking events removed due to reorg',
                );
            }
            return { action: 'removed', inputHash, deletedEvents, blockHash: log.blockHash };
        }

        // 6. Dedup
        const existingId = await this.findIdByHash(inputHash, tx);
        if (existingId) {
            return { action: 'skipped', reason: 'already_exists' };
        }

        // 7. Catch-up reorg
        let reorgDeletedEvents: UniswapV3StakingPositionLedgerEvent[] | undefined;
        const eventsWithSameTxHash = await this.findByTxHash(log.transactionHash, tx);
        for (const existing of eventsWithSameTxHash) {
            const existingBlockHash = existing.typedConfig.blockHash;
            if (existingBlockHash !== log.blockHash) {
                this.logger.debug(
                    { txHash: log.transactionHash, orphanedBlockHash: existingBlockHash, canonicalBlockHash: log.blockHash },
                    'Catch-up reorg detected for staking event',
                );
                reorgDeletedEvents = await this.deleteAllByBlockHash(existingBlockHash, tx);
                break;
            }
        }

        // 8. Pool price at event block
        const poolPrice = await poolPriceService.discover(
            { chainId, poolAddress: position.typedConfig.poolAddress },
            { blockNumber: Number(blockNumber), blockHash: log.blockHash },
        );
        const sqrtPriceX96 = poolPrice.sqrtPriceX96;
        const blockTimestamp = poolPrice.timestamp;

        // 9. Decode + branch on event type
        const decoded = decodeStakingLogData(validation.eventType, log.data, log.topics);

        let eventType: EventType;
        let tokenValue: bigint;
        let ledgerState: UniswapV3StakingLedgerEventState;
        let ledgerConfig: UniswapV3StakingLedgerEventConfig;
        const isToken0Quote = position.typedConfig.isToken0Quote;

        switch (decoded.eventType) {
            case 'STAKE': {
                const ctx = log.chainContext ?? {};
                if (ctx.liquidityAfter === undefined) {
                    throw new Error(
                        `Missing chainContext.liquidityAfter for STAKE log at ${log.transactionHash}:${logIndex}`,
                    );
                }

                // Disambiguate initial vs top-up:
                //  - If a prior STAKING_DEPOSIT exists for this position → top-up.
                //  - Else if vault.state() at block-1 was Empty → initial.
                //  - Else if vault.state() at block-1 was Staked → top-up.
                const last = await this.findLast(tx);
                const hasPriorDeposit = last !== null;
                let isInitial: boolean;
                if (hasPriorDeposit) {
                    isInitial = false;
                } else if (ctx.vaultStateBefore === 'Empty') {
                    isInitial = true;
                } else if (ctx.vaultStateBefore === 'Staked') {
                    isInitial = false;
                } else if (ctx.vaultStateBefore === undefined) {
                    // Conservative default: no prior event → treat as initial.
                    isInitial = true;
                } else {
                    throw new Error(
                        `Stake event in unexpected vaultStateBefore=${ctx.vaultStateBefore} (tx=${log.transactionHash})`,
                    );
                }

                const liquidityBefore = isInitial
                    ? 0n
                    : (last?.typedConfig.liquidityAfter ?? ctx.liquidityBefore ?? 0n);
                const deltaL = ctx.liquidityAfter - liquidityBefore;

                eventType = 'STAKING_DEPOSIT';
                tokenValue = this.valueOfBaseAndQuote(
                    decoded.base, decoded.quote, sqrtPriceX96, isToken0Quote,
                );

                ledgerState = {
                    eventType: 'STAKING_DEPOSIT',
                    isInitial,
                    owner: decoded.owner,
                    baseAmount: decoded.base,
                    quoteAmount: decoded.quote,
                    yieldTarget: decoded.yieldTarget,
                    underlyingTokenId: Number(decoded.tokenId),
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: this.tokenAmountsForBaseQuote(
                        decoded.base, decoded.quote, isToken0Quote,
                    ),
                };
                ledgerConfig = this.buildBaseConfig(
                    chainId, position.typedConfig.vaultAddress,
                    blockNumber, txIndex, logIndex,
                    log.transactionHash, log.blockHash,
                    deltaL, ctx.liquidityAfter,
                    /* effectiveBps */ 10000, sqrtPriceX96,
                    /* dispose split */ 0n, 0n, 0n, 0n, 0n, 0n,
                    /* source */ null,
                );
                break;
            }

            case 'YIELD_TARGET_SET': {
                eventType = 'STAKING_YIELD_TARGET_SET';
                tokenValue = 0n;
                const last = await this.findLast(tx);
                const liquidityAfter = last?.typedConfig.liquidityAfter ?? 0n;
                ledgerState = {
                    eventType: 'STAKING_YIELD_TARGET_SET',
                    owner: decoded.owner,
                    oldTarget: decoded.oldTarget,
                    newTarget: decoded.newTarget,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: [0n, 0n],
                };
                ledgerConfig = this.buildBaseConfig(
                    chainId, position.typedConfig.vaultAddress,
                    blockNumber, txIndex, logIndex,
                    log.transactionHash, log.blockHash,
                    /* deltaL */ 0n, liquidityAfter,
                    /* effectiveBps */ 0, sqrtPriceX96,
                    0n, 0n, 0n, 0n, 0n, 0n,
                    null,
                );
                break;
            }

            case 'PARTIAL_UNSTAKE_BPS_SET': {
                eventType = 'STAKING_PENDING_BPS_SET';
                tokenValue = 0n;
                const last = await this.findLast(tx);
                const liquidityAfter = last?.typedConfig.liquidityAfter ?? 0n;
                ledgerState = {
                    eventType: 'STAKING_PENDING_BPS_SET',
                    owner: decoded.owner,
                    oldBps: decoded.oldBps,
                    newBps: decoded.newBps,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: [0n, 0n],
                };
                ledgerConfig = this.buildBaseConfig(
                    chainId, position.typedConfig.vaultAddress,
                    blockNumber, txIndex, logIndex,
                    log.transactionHash, log.blockHash,
                    0n, liquidityAfter,
                    0, sqrtPriceX96,
                    0n, 0n, 0n, 0n, 0n, 0n,
                    null,
                );
                break;
            }

            case 'SWAP': {
                const ctx = log.chainContext ?? {};
                if (
                    ctx.liquidityAfter === undefined ||
                    ctx.stakedBaseBefore === undefined ||
                    ctx.stakedQuoteBefore === undefined ||
                    ctx.rewardBufferBaseDelta === undefined ||
                    ctx.rewardBufferQuoteDelta === undefined
                ) {
                    throw new Error(
                        `Missing chainContext fields for SWAP log at ${log.transactionHash}:${logIndex}`,
                    );
                }
                const bps = BigInt(decoded.effectiveBps);
                const principalBase = (ctx.stakedBaseBefore * bps) / 10000n;
                const principalQuote = (ctx.stakedQuoteBefore * bps) / 10000n;
                const yieldBase = ctx.rewardBufferBaseDelta;
                const yieldQuote = ctx.rewardBufferQuoteDelta;

                const principalQuoteValue = this.valueOfBaseAndQuote(
                    principalBase, principalQuote, sqrtPriceX96, isToken0Quote,
                );
                const yieldQuoteValue = this.valueOfBaseAndQuote(
                    yieldBase, yieldQuote, sqrtPriceX96, isToken0Quote,
                );

                const last = await this.findLast(tx);
                const liquidityBefore = last?.typedConfig.liquidityAfter ?? 0n;
                const deltaL = ctx.liquidityAfter - liquidityBefore;

                eventType = 'STAKING_DISPOSE';
                tokenValue = principalQuoteValue + yieldQuoteValue;

                const totalBase = principalBase + yieldBase;
                const totalQuote = principalQuote + yieldQuote;
                ledgerState = {
                    eventType: 'STAKING_DISPOSE',
                    source: 'swap',
                    effectiveBps: decoded.effectiveBps,
                    initiator: decoded.executor,
                    principalBase, principalQuote, yieldBase, yieldQuote,
                    tokenIn: decoded.tokenIn,
                    tokenOut: decoded.tokenOut,
                    amountIn: decoded.amountIn,
                    amountOut: decoded.amountOut,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: this.tokenAmountsForBaseQuote(
                        totalBase, totalQuote, isToken0Quote,
                    ),
                };
                ledgerConfig = this.buildBaseConfig(
                    chainId, position.typedConfig.vaultAddress,
                    blockNumber, txIndex, logIndex,
                    log.transactionHash, log.blockHash,
                    deltaL, ctx.liquidityAfter,
                    decoded.effectiveBps, sqrtPriceX96,
                    principalBase, principalQuote, yieldBase, yieldQuote,
                    principalQuoteValue, yieldQuoteValue,
                    'swap',
                );
                break;
            }

            case 'FLASH_CLOSE_INITIATED': {
                const ctx = log.chainContext ?? {};
                if (ctx.liquidityAfter === undefined) {
                    throw new Error(
                        `Missing chainContext.liquidityAfter for FLASH_CLOSE_INITIATED log at ${log.transactionHash}:${logIndex}`,
                    );
                }
                const unstakeLog = unstakeByTx.get(txHash);
                const claimLog = claimRewardsByTx.get(txHash);
                if (!unstakeLog || !claimLog) {
                    throw new Error(
                        `Missing companion Unstake/ClaimRewards for FlashClose tx ${log.transactionHash}`,
                    );
                }
                const decodedUnstake = decodeStakingLogData(
                    'UNSTAKE', unstakeLog.data, unstakeLog.topics,
                ) as DecodedUnstakeData;
                const decodedClaim = decodeStakingLogData(
                    'CLAIM_REWARDS', claimLog.data, claimLog.topics,
                ) as DecodedClaimRewardsData;

                const principalBase = decodedUnstake.base;
                const principalQuote = decodedUnstake.quote;
                const yieldBase = decodedClaim.baseAmount;
                const yieldQuote = decodedClaim.quoteAmount;

                const principalQuoteValue = this.valueOfBaseAndQuote(
                    principalBase, principalQuote, sqrtPriceX96, isToken0Quote,
                );
                const yieldQuoteValue = this.valueOfBaseAndQuote(
                    yieldBase, yieldQuote, sqrtPriceX96, isToken0Quote,
                );

                const last = await this.findLast(tx);
                const liquidityBefore = last?.typedConfig.liquidityAfter ?? 0n;
                const deltaL = ctx.liquidityAfter - liquidityBefore;

                eventType = 'STAKING_DISPOSE';
                tokenValue = principalQuoteValue + yieldQuoteValue;

                const totalBase = principalBase + yieldBase;
                const totalQuote = principalQuote + yieldQuote;
                ledgerState = {
                    eventType: 'STAKING_DISPOSE',
                    source: 'flashClose',
                    effectiveBps: decoded.bps,
                    initiator: decoded.owner,
                    principalBase, principalQuote, yieldBase, yieldQuote,
                    tokenIn: '0x0000000000000000000000000000000000000000',
                    tokenOut: '0x0000000000000000000000000000000000000000',
                    amountIn: 0n,
                    amountOut: 0n,
                    poolPrice: sqrtPriceX96,
                    tokenAmounts: this.tokenAmountsForBaseQuote(
                        totalBase, totalQuote, isToken0Quote,
                    ),
                };
                ledgerConfig = this.buildBaseConfig(
                    chainId, position.typedConfig.vaultAddress,
                    blockNumber, txIndex, logIndex,
                    log.transactionHash, log.blockHash,
                    deltaL, ctx.liquidityAfter,
                    decoded.bps, sqrtPriceX96,
                    principalBase, principalQuote, yieldBase, yieldQuote,
                    principalQuoteValue, yieldQuoteValue,
                    'flashClose',
                );
                break;
            }

            // UNSTAKE / CLAIM_REWARDS handled above in step 2; cannot reach here.
            case 'UNSTAKE':
            case 'CLAIM_REWARDS':
                throw new Error(
                    `${decoded.eventType} reached the dispatch branch (should have been suppressed): ${log.transactionHash}:${logIndex}`,
                );
        }

        const createInput: CreateStakingLedgerEventInput = {
            previousId: null,
            timestamp: blockTimestamp,
            eventType,
            inputHash,
            tokenValue,
            rewards: [],
            // Placeholder zeros — recalculateAggregates rebuilds these.
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
            eventDetail: { eventType, tokenValue, blockTimestamp },
            ...(reorgDeletedEvents !== undefined && { reorgDeletedEvents }),
        };
    }

    // ============================================================================
    // PNL ENGINE — MODEL A SEMANTICS
    // ============================================================================

    /**
     * Recalculate all running totals by replaying events chronologically.
     *
     * Model A divergence from UniswapV3LedgerService:
     * - STAKING_DISPOSE.deltaPnl = principalQuoteValue − proportionalCostBasis
     *   (yield is NOT in PnL; it goes to deltaCollectedYield only)
     *
     * The `_isToken0Quote` parameter is unused at this layer because the
     * principal/yield split is pre-computed in quote units at insert time
     * (see `processSingleLog`). It is retained for signature parity with
     * UniswapV3VaultLedgerService.recalculateAggregates.
     */
    async recalculateAggregates(
        _isToken0Quote: boolean,
        tx?: PrismaTransactionClient,
    ): Promise<StakingLedgerAggregates> {
        const events = await this.findAll(tx);

        if (events.length === 0) {
            return {
                liquidityAfter: 0n,
                costBasisAfter: 0n,
                realizedPnlAfter: 0n,
                collectedYieldAfter: 0n,
                realizedCashflowAfter: 0n,
            };
        }

        UniswapV3StakingLedgerService.sortByBlockchainCoordinates(events);

        let liquidityAfter = 0n;
        let costBasisAfter = 0n;
        let pnlAfter = 0n;
        let collectedYieldAfter = 0n;
        let previousEventId: string | null = null;

        for (const event of events) {
            const state = event.typedState;
            const config = event.typedConfig;

            const previousLiquidity = liquidityAfter;
            const previousCostBasis = costBasisAfter;
            const previousPnl = pnlAfter;
            const previousCollectedYield = collectedYieldAfter;

            let deltaCostBasis = 0n;
            let deltaPnl = 0n;
            let deltaCollectedYield = 0n;

            switch (state.eventType) {
                case 'STAKING_DEPOSIT': {
                    deltaCostBasis = event.tokenValue;
                    costBasisAfter = previousCostBasis + deltaCostBasis;
                    pnlAfter = previousPnl;
                    collectedYieldAfter = previousCollectedYield;
                    liquidityAfter = config.liquidityAfter;
                    break;
                }
                case 'STAKING_DISPOSE': {
                    const absDeltaL = config.deltaL < 0n ? -config.deltaL : config.deltaL;
                    let proportionalCostBasis = 0n;
                    if (previousLiquidity > 0n && absDeltaL > 0n) {
                        proportionalCostBasis = (absDeltaL * previousCostBasis) / previousLiquidity;
                    }
                    deltaCostBasis = -proportionalCostBasis;
                    costBasisAfter = previousCostBasis + deltaCostBasis;
                    // Model A: yield excluded from PnL.
                    deltaPnl = config.principalQuoteValue - proportionalCostBasis;
                    pnlAfter = previousPnl + deltaPnl;
                    deltaCollectedYield = config.yieldQuoteValue;
                    collectedYieldAfter = previousCollectedYield + deltaCollectedYield;
                    liquidityAfter = config.liquidityAfter;
                    break;
                }
                case 'STAKING_YIELD_TARGET_SET':
                case 'STAKING_PENDING_BPS_SET': {
                    // Markers — no aggregate change.
                    costBasisAfter = previousCostBasis;
                    pnlAfter = previousPnl;
                    collectedYieldAfter = previousCollectedYield;
                    liquidityAfter = previousLiquidity;
                    break;
                }
            }

            await this.updateEventAggregates(
                event.id,
                {
                    previousId: previousEventId,
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

        return {
            liquidityAfter,
            costBasisAfter,
            realizedPnlAfter: pnlAfter,
            collectedYieldAfter,
            realizedCashflowAfter: 0n,
        };
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    private async updateEventAggregates(
        eventId: string,
        updates: UpdateStakingEventAggregatesInput,
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        const db = tx ?? this.prisma;
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
            },
        });
    }

    /**
     * Total quote-units value of (baseAmount × P + quoteAmount).
     * Direction depends on isToken0Quote.
     */
    private valueOfBaseAndQuote(
        baseAmount: bigint,
        quoteAmount: bigint,
        sqrtPriceX96: bigint,
        isToken0Quote: boolean,
    ): bigint {
        if (isToken0Quote) {
            // base = token1, quote = token0.
            // valueOfToken1AmountInToken0 returns base value in quote units.
            return valueOfToken1AmountInToken0(baseAmount, sqrtPriceX96) + quoteAmount;
        } else {
            // base = token0, quote = token1.
            return valueOfToken0AmountInToken1(baseAmount, sqrtPriceX96) + quoteAmount;
        }
    }

    /**
     * Map (baseAmount, quoteAmount) → [token0Amount, token1Amount] for ledger state.
     */
    private tokenAmountsForBaseQuote(
        baseAmount: bigint,
        quoteAmount: bigint,
        isToken0Quote: boolean,
    ): bigint[] {
        return isToken0Quote ? [quoteAmount, baseAmount] : [baseAmount, quoteAmount];
    }

    /**
     * Build a base UniswapV3StakingLedgerEventConfig with all dispose-only
     * fields zeroed when not applicable.
     */
    private buildBaseConfig(
        chainId: number,
        vaultAddress: string,
        blockNumber: bigint,
        txIndex: number,
        logIndex: number,
        txHash: string,
        blockHash: string,
        deltaL: bigint,
        liquidityAfter: bigint,
        effectiveBps: number,
        sqrtPriceX96: bigint,
        principalBaseDelta: bigint,
        principalQuoteDelta: bigint,
        yieldBaseDelta: bigint,
        yieldQuoteDelta: bigint,
        principalQuoteValue: bigint,
        yieldQuoteValue: bigint,
        source: 'swap' | 'flashClose' | null,
    ): UniswapV3StakingLedgerEventConfig {
        return {
            chainId,
            vaultAddress,
            blockNumber,
            txIndex,
            logIndex,
            txHash,
            blockHash,
            deltaL,
            liquidityAfter,
            effectiveBps,
            sqrtPriceX96,
            principalBaseDelta,
            principalQuoteDelta,
            yieldBaseDelta,
            yieldQuoteDelta,
            principalQuoteValue,
            yieldQuoteValue,
            source,
        };
    }
}
