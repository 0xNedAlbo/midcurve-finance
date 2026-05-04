/**
 * UniswapV3StakingLedgerService — unit tests
 *
 * Synthetic-fixture tests covering SPEC-0003b PR1 acceptance:
 *  - Stake (initial) → STAKING_DEPOSIT
 *  - Stake (top-up) → second STAKING_DEPOSIT, exercises non-Empty vaultStateBefore
 *  - Swap (50% partial) → STAKING_DISPOSE, principal/yield split, Model A semantics
 *  - FlashClose composition → single synthesized STAKING_DISPOSE
 *  - Marker events (YieldTargetSet / PartialUnstakeBpsSet)
 *  - Standalone Unstake / ClaimRewards suppression
 *  - Validation: wrong contract / wrong owner / unknown topic0
 *  - Idempotency: rerun produces same row count
 *  - Reorg: deleteAllByBlockHash cascades
 *  - Model A invariant: yield-only flat-principal vs. principal-floor gain
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeAbiParameters, keccak256, toBytes, pad } from 'viem';
import type { PrismaClient } from '@midcurve/database';
import type { UniswapV3StakingPosition } from '@midcurve/shared';
import {
    UniswapV3StakingLedgerService,
    STAKING_VAULT_EVENT_SIGNATURES,
    type StakingRawLogInput,
    type StakingLogChainContext,
} from './uniswapv3-staking-ledger-service.js';

// ============================================================================
// MODULE MOCK: domain event publisher
// ============================================================================

const mockCreateAndPublish = vi.fn();
const mockPublisher = { createAndPublish: mockCreateAndPublish };

vi.mock('../../events/index.js', async (importOriginal) => {
    const original: object = await (importOriginal as () => Promise<object>)();
    return {
        ...original,
        getDomainEventPublisher: vi.fn(() => mockPublisher),
    };
});

// ============================================================================
// FIXTURES
// ============================================================================

const POSITION_ID = 'pos_staking_test';
const CHAIN_ID = 42161;
const VAULT_ADDRESS = '0xA1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1';
const OWNER_ADDRESS = '0xB2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2';
const POOL_ADDRESS = '0xC3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3';
const EXECUTOR_ADDRESS = '0xD4D4D4D4D4D4D4D4D4D4D4D4D4D4D4D4D4D4D4D4';
const TOKEN0 = '0x0000000000000000000000000000000000000001';
const TOKEN1 = '0x0000000000000000000000000000000000000002';

const SQRT_PRICE_1_TO_1 = 2n ** 96n;
const BASE_TIMESTAMP = new Date('2026-04-01T00:00:00Z');

const POSITION_CONTEXT = {
    typedConfig: {
        isToken0Quote: false, // base = token0, quote = token1
        vaultAddress: VAULT_ADDRESS,
        poolAddress: POOL_ADDRESS,
    },
};

// ============================================================================
// IN-MEMORY PRISMA MOCK
// ============================================================================

interface StoredEvent {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    positionId: string;
    protocol: string;
    previousId: string | null;
    timestamp: Date;
    eventType: string;
    inputHash: string;
    tokenValue: string;
    rewards: unknown;
    deltaCostBasis: string;
    costBasisAfter: string;
    deltaPnl: string;
    pnlAfter: string;
    deltaCollectedYield: string;
    collectedYieldAfter: string;
    deltaRealizedCashflow: string;
    realizedCashflowAfter: string;
    isIgnored: boolean;
    ignoredReason: string | null;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
}

class FakePrisma {
    public store: StoredEvent[] = [];
    private nextId = 1;

    positionLedgerEvent = {
        create: vi.fn(async ({ data }: { data: any }) => {
            const row: StoredEvent = {
                id: `evt_${this.nextId++}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
                rewards: data.rewards ?? [],
                isIgnored: data.isIgnored ?? false,
                ignoredReason: data.ignoredReason ?? null,
                previousId: data.previousId ?? null,
            };
            this.store.push(row);
            return row;
        }),
        findFirst: vi.fn(async ({ where }: any) => {
            const inputHash = where?.inputHash;
            if (inputHash !== undefined) {
                const found = this.store.find(
                    (e) =>
                        e.positionId === where.positionId &&
                        e.inputHash === inputHash,
                );
                return found ?? null;
            }
            return this.store.find((e) => e.positionId === where.positionId) ?? null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
            const path = where?.config?.path?.[0];
            const equals = where?.config?.equals;
            if (path === 'txHash') {
                return this.store.filter(
                    (e) =>
                        e.positionId === where.positionId &&
                        (e.config as any).txHash === equals,
                );
            }
            if (path === 'blockHash') {
                return this.store.filter(
                    (e) =>
                        e.positionId === where.positionId &&
                        (e.config as any).blockHash === equals,
                );
            }
            const ids = where?.id?.in;
            if (Array.isArray(ids)) {
                return this.store.filter((e) => ids.includes(e.id));
            }
            return this.store.filter((e) => e.positionId === where.positionId);
        }),
        update: vi.fn(async ({ where, data }: any) => {
            const idx = this.store.findIndex((e) => e.id === where.id);
            if (idx < 0) throw new Error(`update: id ${where.id} not found`);
            this.store[idx] = { ...this.store[idx], ...data, updatedAt: new Date() } as StoredEvent;
            return this.store[idx];
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
            const ids = where?.id?.in;
            if (Array.isArray(ids)) {
                const before = this.store.length;
                this.store = this.store.filter((e) => !ids.includes(e.id));
                return { count: before - this.store.length };
            }
            const before = this.store.length;
            this.store = this.store.filter((e) => e.positionId !== where.positionId);
            return { count: before - this.store.length };
        }),
    };

    // Tagged template literal handler for ORDER BY (blockNumber DESC, logIndex DESC).
    $queryRaw = vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        const sorted = [...this.store]
            .filter((e) => e.positionId === POSITION_ID)
            .sort((a, b) => {
                const aBn = BigInt((a.config as any).blockNumber);
                const bBn = BigInt((b.config as any).blockNumber);
                if (aBn !== bBn) return aBn < bBn ? 1 : -1;
                return (b.config as any).logIndex - (a.config as any).logIndex;
            });
        // findLast uses LIMIT 1 — we can't easily detect that from a tagged
        // template, but the service handles results.length===0 fine. The
        // service only ever asks for full-list or LIMIT 1; it slices the array
        // itself, so always returning the full sorted list is safe.
        return sorted as unknown[];
    });
}

function makePrismaMock(): { fake: FakePrisma; client: PrismaClient } {
    const fake = new FakePrisma();
    return { fake, client: fake as unknown as PrismaClient };
}

// ============================================================================
// POOL PRICE SERVICE MOCK
// ============================================================================

function makePoolPriceServiceMock(sqrtPriceX96 = SQRT_PRICE_1_TO_1) {
    return {
        discover: vi.fn(async (_pool: any, opts: any) => ({
            sqrtPriceX96,
            timestamp: new Date(BASE_TIMESTAMP.getTime() + (opts?.blockNumber ?? 0) * 1000),
        })),
    } as any;
}

// ============================================================================
// LOG BUILDERS
// ============================================================================

function paddedAddress(address: string): `0x${string}` {
    return pad(address.toLowerCase() as `0x${string}`, { size: 32 });
}

function makeBaseLog(
    sigHex: string,
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    extras: { topics?: string[]; data?: `0x${string}`; chainContext?: StakingLogChainContext } = {},
): StakingRawLogInput {
    return {
        address: VAULT_ADDRESS,
        topics: [sigHex, ...(extras.topics ?? [])],
        data: extras.data ?? '0x',
        blockNumber,
        blockHash,
        transactionHash: txHash,
        transactionIndex: 0,
        logIndex,
        removed: false,
        chainContext: extras.chainContext,
    };
}

function makeStakeLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: {
        base: bigint;
        quote: bigint;
        yieldTarget: bigint;
        tokenId: bigint;
        chainContext: StakingLogChainContext;
        ownerOverride?: string;
    },
): StakingRawLogInput {
    const owner = args.ownerOverride ?? OWNER_ADDRESS;
    const data = encodeAbiParameters(
        [
            { name: 'base', type: 'uint256' },
            { name: 'quote', type: 'uint256' },
            { name: 'yieldTarget', type: 'uint256' },
            { name: 'tokenId', type: 'uint256' },
        ],
        [args.base, args.quote, args.yieldTarget, args.tokenId],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.STAKE,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(owner)], data, chainContext: args.chainContext },
    );
}

function makeSwapLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: {
        executor?: string;
        tokenIn: string;
        amountIn: bigint;
        tokenOut: string;
        amountOut: bigint;
        effectiveBps: number;
        chainContext: StakingLogChainContext;
    },
): StakingRawLogInput {
    const executor = args.executor ?? EXECUTOR_ADDRESS;
    const data = encodeAbiParameters(
        [
            { name: 'tokenIn', type: 'address' },
            { name: 'amountIn', type: 'uint256' },
            { name: 'tokenOut', type: 'address' },
            { name: 'amountOut', type: 'uint256' },
            { name: 'effectiveBps', type: 'uint16' },
        ],
        [args.tokenIn as `0x${string}`, args.amountIn, args.tokenOut as `0x${string}`, args.amountOut, args.effectiveBps],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.SWAP,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(executor)], data, chainContext: args.chainContext },
    );
}

function makeFlashCloseInitiatedLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: {
        bps: number;
        callbackTarget: string;
        chainContext: StakingLogChainContext;
    },
): StakingRawLogInput {
    const data = encodeAbiParameters(
        [
            { name: 'bps', type: 'uint16' },
            { name: 'data', type: 'bytes' },
        ],
        [args.bps, '0x'],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.FLASH_CLOSE_INITIATED,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(OWNER_ADDRESS), paddedAddress(args.callbackTarget)], data, chainContext: args.chainContext },
    );
}

function makeUnstakeLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: { base: bigint; quote: bigint },
): StakingRawLogInput {
    const data = encodeAbiParameters(
        [
            { name: 'base', type: 'uint256' },
            { name: 'quote', type: 'uint256' },
        ],
        [args.base, args.quote],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.UNSTAKE,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(OWNER_ADDRESS)], data },
    );
}

function makeClaimRewardsLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: { base: bigint; quote: bigint },
): StakingRawLogInput {
    const data = encodeAbiParameters(
        [
            { name: 'baseAmount', type: 'uint256' },
            { name: 'quoteAmount', type: 'uint256' },
        ],
        [args.base, args.quote],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.CLAIM_REWARDS,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(OWNER_ADDRESS)], data },
    );
}

function makeYieldTargetSetLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: { oldTarget: bigint; newTarget: bigint },
): StakingRawLogInput {
    const data = encodeAbiParameters(
        [
            { name: 'oldTarget', type: 'uint256' },
            { name: 'newTarget', type: 'uint256' },
        ],
        [args.oldTarget, args.newTarget],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.YIELD_TARGET_SET,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(OWNER_ADDRESS)], data },
    );
}

function makePartialUnstakeBpsSetLog(
    blockNumber: bigint,
    txHash: string,
    blockHash: string,
    logIndex: number,
    args: { oldBps: number; newBps: number },
): StakingRawLogInput {
    const data = encodeAbiParameters(
        [
            { name: 'oldBps', type: 'uint16' },
            { name: 'newBps', type: 'uint16' },
        ],
        [args.oldBps, args.newBps],
    );
    return makeBaseLog(
        STAKING_VAULT_EVENT_SIGNATURES.PARTIAL_UNSTAKE_BPS_SET,
        blockNumber, txHash, blockHash, logIndex,
        { topics: [paddedAddress(OWNER_ADDRESS)], data },
    );
}

// ============================================================================
// TESTS
// ============================================================================

describe('UniswapV3StakingLedgerService', () => {
    let fake: FakePrisma;
    let service: UniswapV3StakingLedgerService;
    let poolPriceService: ReturnType<typeof makePoolPriceServiceMock>;

    beforeEach(() => {
        const { fake: f, client } = makePrismaMock();
        fake = f;
        service = new UniswapV3StakingLedgerService(
            { positionId: POSITION_ID },
            { prisma: client },
        );
        poolPriceService = makePoolPriceServiceMock();
    });

    // ============================================================================
    // STATIC HASH
    // ============================================================================

    describe('createHash', () => {
        it('produces uniswapv3-staking/{chainId}/{txHash}/{blockHash}/{logIndex}', () => {
            const hash = UniswapV3StakingLedgerService.createHash(
                42161, '0xtx', '0xblk', 7,
            );
            expect(hash).toBe('uniswapv3-staking/42161/0xtx/0xblk/7');
        });
    });

    // ============================================================================
    // STAKE — INITIAL
    // ============================================================================

    describe('Stake (initial)', () => {
        it('inserts STAKING_DEPOSIT with correct cost basis and zero PnL', async () => {
            const log = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: {
                    vaultStateBefore: 'Empty',
                    liquidityAfter: 1_000_000n,
                },
            });

            const result = await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [log], poolPriceService,
            );

            expect(fake.store.length).toBe(1);
            const row = fake.store[0]!;
            expect(row.eventType).toBe('STAKING_DEPOSIT');
            // tokenValue = base*P + quote = 1000*1 + 500 = 1500 (sqrtPrice 1:1, isToken0Quote=false)
            expect(row.tokenValue).toBe('1500');
            expect(row.deltaCostBasis).toBe('1500');
            expect(row.costBasisAfter).toBe('1500');
            expect(row.pnlAfter).toBe('0');
            expect(row.collectedYieldAfter).toBe('0');
            const cfg = row.config as any;
            expect(cfg.deltaL).toBe('1000000');
            expect(cfg.liquidityAfter).toBe('1000000');
            expect(cfg.effectiveBps).toBe(10000);
            const state = row.state as any;
            expect(state.eventType).toBe('STAKING_DEPOSIT');
            expect(state.isInitial).toBe(true);
            expect(state.baseAmount).toBe('1000');
            expect(state.quoteAmount).toBe('500');
            expect(result.postImportAggregates.costBasisAfter).toBe(1500n);
            expect(result.postImportAggregates.liquidityAfter).toBe(1_000_000n);
        });
    });

    // ============================================================================
    // STAKE — TOP-UP
    // ============================================================================

    describe('Stake (top-up) — vaultStateBefore=Staked precondition', () => {
        it('chains liquidityBefore from prior STAKING_DEPOSIT and accumulates cost basis', async () => {
            const initial = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const topUp = makeStakeLog(200n, '0xtx2', '0xblk2', 0, {
                base: 2000n,
                quote: 1000n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Staked', liquidityAfter: 3_000_000n },
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [initial, topUp], poolPriceService,
            );

            expect(fake.store.length).toBe(2);
            const events = [...fake.store].sort(
                (a, b) => Number((a.config as any).blockNumber) - Number((b.config as any).blockNumber),
            );
            const initialRow = events[0]!;
            const topUpRow = events[1]!;

            expect(initialRow.eventType).toBe('STAKING_DEPOSIT');
            expect((initialRow.state as any).isInitial).toBe(true);

            expect(topUpRow.eventType).toBe('STAKING_DEPOSIT');
            expect((topUpRow.state as any).isInitial).toBe(false);
            // deltaL = 3_000_000 - 1_000_000 = 2_000_000 (chain-from-previous, no RPC for top-up)
            expect((topUpRow.config as any).deltaL).toBe('2000000');
            expect((topUpRow.config as any).liquidityAfter).toBe('3000000');
            // tokenValue = 2000*1 + 1000 = 3000
            expect(topUpRow.tokenValue).toBe('3000');
            // costBasisAfter accumulates: 1500 + 3000 = 4500
            expect(topUpRow.costBasisAfter).toBe('4500');
            expect(topUpRow.pnlAfter).toBe('0');
        });
    });

    // ============================================================================
    // SWAP — 50% PARTIAL DISPOSE
    // ============================================================================

    describe('Swap (50% partial)', () => {
        it('emits STAKING_DISPOSE with principal/yield split and Model A semantics', async () => {
            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const swap = makeSwapLog(200n, '0xtx2', '0xblk2', 0, {
                tokenIn: TOKEN1,
                amountIn: 250n,
                tokenOut: TOKEN0,
                amountOut: 250n,
                effectiveBps: 5000,
                chainContext: {
                    stakedBaseBefore: 1000n,
                    stakedQuoteBefore: 500n,
                    rewardBufferBaseDelta: 50n, // yield base
                    rewardBufferQuoteDelta: 25n, // yield quote
                    liquidityAfter: 500_000n, // halved
                },
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, swap], poolPriceService,
            );

            const events = [...fake.store].sort(
                (a, b) => Number((a.config as any).blockNumber) - Number((b.config as any).blockNumber),
            );
            const swapRow = events[1]!;
            expect(swapRow.eventType).toBe('STAKING_DISPOSE');

            // principal = stakedBefore × bps / 10000:
            //   principalBase  = 1000 × 5000 / 10000 = 500
            //   principalQuote =  500 × 5000 / 10000 = 250
            // principalQuoteValue = principalBase*1 + principalQuote = 500 + 250 = 750
            // yieldQuoteValue     = yieldBase*1 + yieldQuote         =  50 +  25 =  75
            // tokenValue = 750 + 75 = 825
            expect(swapRow.tokenValue).toBe('825');

            const cfg = swapRow.config as any;
            expect(cfg.principalBaseDelta).toBe('500');
            expect(cfg.principalQuoteDelta).toBe('250');
            expect(cfg.yieldBaseDelta).toBe('50');
            expect(cfg.yieldQuoteDelta).toBe('25');
            expect(cfg.principalQuoteValue).toBe('750');
            expect(cfg.yieldQuoteValue).toBe('75');
            expect(cfg.source).toBe('swap');
            expect(cfg.effectiveBps).toBe(5000);
            expect(cfg.deltaL).toBe('-500000');

            // Aggregate recalculation (Model A):
            //   proportionalCostBasis = |deltaL| × prevCostBasis / prevLiquidity
            //                         = 500_000 × 1500 / 1_000_000 = 750
            //   deltaCostBasis = -750
            //   costBasisAfter = 1500 - 750 = 750
            //   deltaPnl = principalQuoteValue - proportionalCostBasis = 750 - 750 = 0
            //   pnlAfter = 0
            //   deltaCollectedYield = yieldQuoteValue = 75
            //   collectedYieldAfter = 75
            expect(swapRow.deltaCostBasis).toBe('-750');
            expect(swapRow.costBasisAfter).toBe('750');
            expect(swapRow.deltaPnl).toBe('0');
            expect(swapRow.pnlAfter).toBe('0');
            expect(swapRow.deltaCollectedYield).toBe('75');
            expect(swapRow.collectedYieldAfter).toBe('75');
        });
    });

    // ============================================================================
    // FLASHCLOSE COMPOSITION
    // ============================================================================

    describe('FlashClose composition', () => {
        it('folds FlashCloseInitiated + same-tx Unstake + ClaimRewards into a single STAKING_DISPOSE', async () => {
            const stake = makeStakeLog(100n, '0xtxA', '0xblkA', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const fci = makeFlashCloseInitiatedLog(200n, '0xtxFC', '0xblkFC', 0, {
                bps: 10000,
                callbackTarget: '0xE5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5',
                chainContext: { liquidityAfter: 0n },
            });
            const unstake = makeUnstakeLog(200n, '0xtxFC', '0xblkFC', 1, {
                base: 1000n, quote: 500n,
            });
            const claim = makeClaimRewardsLog(200n, '0xtxFC', '0xblkFC', 2, {
                base: 100n, quote: 50n,
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, fci, unstake, claim], poolPriceService,
            );

            // Expect 2 events: stake + 1 synthesized dispose. Standalone Unstake/Claim are folded.
            expect(fake.store.length).toBe(2);
            const dispose = fake.store.find((e) => e.eventType === 'STAKING_DISPOSE')!;
            expect(dispose).toBeDefined();
            const state = dispose.state as any;
            expect(state.source).toBe('flashClose');
            expect(state.principalBase).toBe('1000');
            expect(state.principalQuote).toBe('500');
            expect(state.yieldBase).toBe('100');
            expect(state.yieldQuote).toBe('50');
            // tokenValue = (1000+500) + (100+50) = 1500 + 150 = 1650
            expect(dispose.tokenValue).toBe('1650');
            // proportionalCostBasis = 1_000_000 × 1500 / 1_000_000 = 1500
            // deltaPnl = principalQuoteValue - proportionalCostBasis = 1500 - 1500 = 0
            expect(dispose.deltaPnl).toBe('0');
            // deltaCollectedYield = yieldQuoteValue = 150
            expect(dispose.collectedYieldAfter).toBe('150');
        });
    });

    // ============================================================================
    // MARKER EVENTS
    // ============================================================================

    describe('Marker events', () => {
        it('YieldTargetSet → STAKING_YIELD_TARGET_SET with no aggregate change', async () => {
            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const yt = makeYieldTargetSetLog(110n, '0xtx2', '0xblk2', 0, {
                oldTarget: 100n, newTarget: 200n,
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, yt], poolPriceService,
            );

            const ytRow = fake.store.find((e) => e.eventType === 'STAKING_YIELD_TARGET_SET')!;
            expect(ytRow).toBeDefined();
            expect(ytRow.tokenValue).toBe('0');
            expect(ytRow.deltaCostBasis).toBe('0');
            expect(ytRow.deltaPnl).toBe('0');
            expect(ytRow.deltaCollectedYield).toBe('0');
            expect(ytRow.costBasisAfter).toBe('1500');
        });

        it('PartialUnstakeBpsSet → STAKING_PENDING_BPS_SET with no aggregate change', async () => {
            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const bps = makePartialUnstakeBpsSetLog(110n, '0xtx2', '0xblk2', 0, {
                oldBps: 0, newBps: 5000,
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, bps], poolPriceService,
            );

            const bpsRow = fake.store.find((e) => e.eventType === 'STAKING_PENDING_BPS_SET')!;
            expect(bpsRow).toBeDefined();
            expect(bpsRow.deltaCostBasis).toBe('0');
            expect((bpsRow.state as any).newBps).toBe(5000);
        });
    });

    // ============================================================================
    // STANDALONE DRAINS (NOT IN FLASHCLOSE TX) — SUPPRESSED
    // ============================================================================

    describe('standalone Unstake / ClaimRewards', () => {
        it('are suppressed (no ledger event created)', async () => {
            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n,
                quote: 500n,
                yieldTarget: 100n,
                tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const unstake = makeUnstakeLog(150n, '0xtxStandalone1', '0xblkS1', 0, {
                base: 200n, quote: 100n,
            });
            const claim = makeClaimRewardsLog(160n, '0xtxStandalone2', '0xblkS2', 0, {
                base: 50n, quote: 25n,
            });

            const result = await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, unstake, claim], poolPriceService,
            );

            // Only the Stake → STAKING_DEPOSIT event is persisted.
            expect(fake.store.length).toBe(1);
            const skipped = result.perLogResults.filter((r) => r.action === 'skipped');
            expect(skipped.length).toBe(2);
            expect(skipped.every((r) => r.action === 'skipped' && r.reason === 'standalone_drain'))
                .toBe(true);
        });
    });

    // ============================================================================
    // VALIDATION
    // ============================================================================

    describe('Validation', () => {
        it('rejects logs from a different contract (wrong_contract)', async () => {
            const wrongAddr = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1n },
            });
            wrongAddr.address = '0xFEFEFEFEFEFEFEFEFEFEFEFEFEFEFEFEFEFEFEFE';

            const result = await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [wrongAddr], poolPriceService,
            );
            expect(fake.store.length).toBe(0);
            expect(result.perLogResults[0]).toEqual({ action: 'skipped', reason: 'invalid_event' });
        });

        it('rejects owner-indexed events with a different owner topic (wrong_owner)', async () => {
            const wrongOwner = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1n },
                ownerOverride: '0xCAFECAFECAFECAFECAFECAFECAFECAFECAFECAFE',
            });

            const result = await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [wrongOwner], poolPriceService,
            );
            expect(fake.store.length).toBe(0);
            expect(result.perLogResults[0]).toEqual({ action: 'skipped', reason: 'invalid_event' });
        });

        it('rejects unknown topic0', async () => {
            const unknown: StakingRawLogInput = {
                address: VAULT_ADDRESS,
                topics: [keccak256(toBytes('UnrelatedEvent()')), paddedAddress(OWNER_ADDRESS)],
                data: '0x',
                blockNumber: 100n,
                blockHash: '0xblk1',
                transactionHash: '0xtx1',
                transactionIndex: 0,
                logIndex: 0,
            };

            const result = await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [unknown], poolPriceService,
            );
            expect(fake.store.length).toBe(0);
            expect(result.perLogResults[0]).toEqual({ action: 'skipped', reason: 'invalid_event' });
        });
    });

    // ============================================================================
    // IDEMPOTENCY
    // ============================================================================

    describe('Idempotency', () => {
        it('rerunning import with the same logs produces the same row count', async () => {
            const log = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [log], poolPriceService,
            );
            const after1 = fake.store.length;
            const cb1 = fake.store[0]!.costBasisAfter;

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [log], poolPriceService,
            );
            const after2 = fake.store.length;
            const cb2 = fake.store[0]!.costBasisAfter;

            expect(after1).toBe(1);
            expect(after2).toBe(1);
            expect(cb1).toBe(cb2);
        });
    });

    // ============================================================================
    // REORG
    // ============================================================================

    describe('Reorg handling', () => {
        it('deleteAllByBlockHash removes events with matching blockHash', async () => {
            const log = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [log], poolPriceService,
            );
            expect(fake.store.length).toBe(1);

            const deleted = await service.deleteAllByBlockHash('0xblk1');
            expect(deleted.length).toBe(1);
            expect(fake.store.length).toBe(0);
        });

        it('removed:true triggers blockHash deletion', async () => {
            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake], poolPriceService,
            );
            expect(fake.store.length).toBe(1);

            const removalLog = { ...stake, removed: true };
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [removalLog], poolPriceService,
            );
            expect(fake.store.length).toBe(0);
        });
    });

    // ============================================================================
    // MODEL A INVARIANT — §12.4
    // ============================================================================

    describe('Model A invariant', () => {
        it('flat-principal yield-only swap → pnlAfter=0, collectedYieldAfter=yieldQuoteValue', async () => {
            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            // 100% dispose at the same price (no principal P&L), with 200 yield in quote terms
            const swap = makeSwapLog(200n, '0xtx2', '0xblk2', 0, {
                tokenIn: TOKEN1,
                amountIn: 0n,
                tokenOut: TOKEN0,
                amountOut: 0n,
                effectiveBps: 10000,
                chainContext: {
                    stakedBaseBefore: 1000n,
                    stakedQuoteBefore: 500n,
                    rewardBufferBaseDelta: 100n,
                    rewardBufferQuoteDelta: 100n, // yieldQuoteValue = 100*1 + 100 = 200
                    liquidityAfter: 0n,
                },
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, swap], poolPriceService,
            );

            const dispose = fake.store.find((e) => e.eventType === 'STAKING_DISPOSE')!;
            // principalQuoteValue = 1000+500 = 1500
            // proportionalCostBasis = full disposal = 1500 (whole position)
            // deltaPnl = 1500 - 1500 = 0  ← Model A: principal break-even
            expect(dispose.deltaPnl).toBe('0');
            expect(dispose.pnlAfter).toBe('0');
            expect(dispose.deltaCollectedYield).toBe('200');
            expect(dispose.collectedYieldAfter).toBe('200');
        });

        it('positive principal-floor gain → pnlAfter > 0 independent of yield', async () => {
            // Initial stake at 1:1, then dispose 100% at price 2:1 (price higher).
            // Track simulated 2:1 price by injecting a different sqrtPrice for the swap block.
            const SQRT_PRICE_2_TO_1 = 2n ** 96n * 2n; // sqrtPrice^2 / 2^192 = 4
            const ppMock = {
                discover: vi.fn(async (_pool: any, opts: any) => ({
                    sqrtPriceX96: opts.blockNumber === 200 ? SQRT_PRICE_2_TO_1 : SQRT_PRICE_1_TO_1,
                    timestamp: BASE_TIMESTAMP,
                })),
            } as any;

            const stake = makeStakeLog(100n, '0xtx1', '0xblk1', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const swap = makeSwapLog(200n, '0xtx2', '0xblk2', 0, {
                tokenIn: TOKEN1, amountIn: 0n, tokenOut: TOKEN0, amountOut: 0n,
                effectiveBps: 10000,
                chainContext: {
                    stakedBaseBefore: 1000n, stakedQuoteBefore: 500n,
                    rewardBufferBaseDelta: 0n, rewardBufferQuoteDelta: 0n, // zero yield
                    liquidityAfter: 0n,
                },
            });

            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake, swap], ppMock,
            );

            const dispose = fake.store.find((e) => e.eventType === 'STAKING_DISPOSE')!;
            // principalQuoteValue at price=4 (token0→token1): base*4 + quote = 1000*4 + 500 = 4500
            // proportionalCostBasis = 1500 (full disposal at original cost basis)
            // deltaPnl = 4500 - 1500 = 3000 (purely principal-floor gain)
            expect(BigInt(dispose.deltaPnl)).toBeGreaterThan(0n);
            expect(dispose.deltaCollectedYield).toBe('0');
        });
    });

    // ============================================================================
    // PR2 — syncFromChain end-to-end (chain pull + publish)
    // ============================================================================

    describe('syncFromChain', () => {
        const FACTORY_ADDRESS = '0xFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFA';
        const POSITION_HASH = `uniswapv3-staking/${CHAIN_ID}/${VAULT_ADDRESS}`;

        // Duck-typed UniswapV3StakingPosition: only the fields syncFromChain
        // and importLogsForPosition read.
        function makePosition(): UniswapV3StakingPosition {
            return {
                id: POSITION_ID,
                userId: 'user_test',
                positionHash: POSITION_HASH,
                chainId: CHAIN_ID,
                vaultAddress: VAULT_ADDRESS,
                ownerAddress: OWNER_ADDRESS,
                underlyingTokenId: 42,
                factoryAddress: FACTORY_ADDRESS,
                typedConfig: {
                    isToken0Quote: false,
                    vaultAddress: VAULT_ADDRESS,
                    poolAddress: POOL_ADDRESS,
                },
            } as unknown as UniswapV3StakingPosition;
        }

        // Build a viem Log shape from a StakingRawLogInput.
        function toViemLog(raw: StakingRawLogInput) {
            return {
                address: raw.address,
                topics: raw.topics,
                data: raw.data,
                blockNumber: typeof raw.blockNumber === 'string' ? BigInt(raw.blockNumber) : raw.blockNumber,
                blockHash: raw.blockHash,
                transactionHash: raw.transactionHash,
                transactionIndex: typeof raw.transactionIndex === 'string' ? Number(raw.transactionIndex) : raw.transactionIndex,
                logIndex: typeof raw.logIndex === 'string' ? Number(raw.logIndex) : raw.logIndex,
                removed: raw.removed ?? false,
            };
        }

        interface MockClientOpts {
            finalizedBlock?: bigint;
            currentBlock?: bigint;
            logsByEventName: Record<string, ReturnType<typeof toViemLog>[]>;
            vaultStateByBlock?: Record<string, number>; // keyed by string(blockNumber)
            vaultUintByFnAndBlock?: Record<string, Record<string, bigint>>; // [fn][block]
            nfpmLiquidityByBlock?: Record<string, bigint>;
            vaultCreatedLogs?: ReturnType<typeof toViemLog>[];
        }

        function makeMockClient(opts: MockClientOpts) {
            const client = {
                chain: { id: CHAIN_ID },
                getChainId: vi.fn(async () => CHAIN_ID),
                getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) => {
                    if (blockTag === 'finalized') {
                        return { number: opts.finalizedBlock ?? 1_000_000n };
                    }
                    throw new Error(`Unsupported blockTag: ${blockTag}`);
                }),
                getBlockNumber: vi.fn(async () => opts.currentBlock ?? 1_000_000n),
                getLogs: vi.fn(async (params: {
                    address?: string;
                    event?: { name: string };
                    args?: Record<string, unknown>;
                    fromBlock?: bigint;
                    toBlock?: bigint | 'latest';
                }) => {
                    const eventName = params.event?.name;
                    if (eventName === 'VaultCreated') {
                        return opts.vaultCreatedLogs ?? [];
                    }
                    return opts.logsByEventName[eventName ?? ''] ?? [];
                }),
                readContract: vi.fn(async (params: {
                    functionName: string;
                    args?: unknown[];
                    blockNumber?: bigint;
                }) => {
                    const fn = params.functionName;
                    const blockKey = params.blockNumber !== undefined
                        ? params.blockNumber.toString()
                        : 'latest';
                    if (fn === 'state') {
                        return opts.vaultStateByBlock?.[blockKey] ?? 0;
                    }
                    if (fn === 'positions') {
                        const liquidity = opts.nfpmLiquidityByBlock?.[blockKey] ?? 0n;
                        return [
                            0n, '0x0000000000000000000000000000000000000000',
                            TOKEN0, TOKEN1, 3000, -100, 100,
                            liquidity, 0n, 0n, 0n, 0n,
                        ];
                    }
                    if (
                        fn === 'stakedBase' || fn === 'stakedQuote' ||
                        fn === 'rewardBufferBase' || fn === 'rewardBufferQuote'
                    ) {
                        return opts.vaultUintByFnAndBlock?.[fn]?.[blockKey] ?? 0n;
                    }
                    throw new Error(`Unmocked readContract: ${fn} at block ${blockKey}`);
                }),
            };
            return client;
        }

        type FinalityOverride =
            | { type: 'blockTag' }
            | { type: 'blockHeight'; minBlockHeight: number };

        function makeEvmConfig(
            client: ReturnType<typeof makeMockClient>,
            finality: FinalityOverride = { type: 'blockTag' },
        ) {
            return {
                getPublicClient: vi.fn(() => client),
                getFinalityConfig: vi.fn(() => finality),
            } as any;
        }

        beforeEach(() => {
            mockCreateAndPublish.mockReset();
        });

        // ----------------------------------------------------------------------
        // 1. Happy path: Stake + Swap end-to-end
        // ----------------------------------------------------------------------
        it('happy path — Stake + Swap → 2 ledger rows + 2 domain events', async () => {
            const stakeRaw = makeStakeLog(100n, '0xtxStake', '0xblkStake', 0, {
                base: 1000n, quote: 500n, yieldTarget: 100n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const swapRaw = makeSwapLog(200n, '0xtxSwap', '0xblkSwap', 0, {
                tokenIn: TOKEN1, amountIn: 250n, tokenOut: TOKEN0, amountOut: 250n,
                effectiveBps: 5000,
                chainContext: {
                    stakedBaseBefore: 1000n, stakedQuoteBefore: 500n,
                    rewardBufferBaseDelta: 50n, rewardBufferQuoteDelta: 25n,
                    liquidityAfter: 500_000n,
                },
            });

            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [toViemLog(stakeRaw)],
                    Swap: [toViemLog(swapRaw)],
                    YieldTargetSet: [],
                    PartialUnstakeBpsSet: [],
                    Unstake: [],
                    ClaimRewards: [],
                    FlashCloseInitiated: [],
                },
                // Stake at block 100, vaultState read at block 99 (block-1)
                vaultStateByBlock: { '99': 0 /* Empty */ },
                // NFPM liquidity reads
                nfpmLiquidityByBlock: { '100': 1_000_000n, '200': 500_000n },
                // Swap at block 200; vault state reads at block 199 + 200
                vaultUintByFnAndBlock: {
                    stakedBase: { '199': 1000n },
                    stakedQuote: { '199': 500n },
                    rewardBufferBase: { '199': 0n, '200': 50n },
                    rewardBufferQuote: { '199': 0n, '200': 25n },
                },
                // VaultCreated lookup — returns the vault's birth block (used because no prior events)
                vaultCreatedLogs: [{
                    address: FACTORY_ADDRESS,
                    topics: [
                        keccak256(toBytes('VaultCreated(address,address)')),
                        pad(OWNER_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                        pad(VAULT_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                    ],
                    data: '0x',
                    blockNumber: 50n, // birth block, well before our stake at 100
                    blockHash: '0xblkBirth',
                    transactionHash: '0xtxBirth',
                    transactionIndex: 0,
                    logIndex: 0,
                    removed: false,
                }],
            });
            const evmConfig = makeEvmConfig(client);

            const result = await service.syncFromChain(
                makePosition(), evmConfig, poolPriceService,
            );

            // 2 ledger rows
            expect(fake.store.length).toBe(2);
            const events = [...fake.store].sort(
                (a, b) => Number((a.config as any).blockNumber) - Number((b.config as any).blockNumber),
            );
            expect(events[0]!.eventType).toBe('STAKING_DEPOSIT');
            expect(events[1]!.eventType).toBe('STAKING_DISPOSE');

            // 2 domain events (one increased, one decreased), no reverts
            expect(mockCreateAndPublish).toHaveBeenCalledTimes(2);
            const types = mockCreateAndPublish.mock.calls.map((c) => c[0].type);
            expect(types).toEqual([
                'position.liquidity.increased',
                'position.liquidity.decreased',
            ]);

            // Payloads carry the right ledgerInputHash + positionHash
            const incCall = mockCreateAndPublish.mock.calls[0]![0];
            expect(incCall.payload.positionHash).toBe(POSITION_HASH);
            expect(incCall.payload.ledgerInputHash).toBe(events[0]!.inputHash);
            expect(incCall.entityId).toBe(POSITION_ID);
            expect(incCall.entityType).toBe('position');

            // Result aggregates reflect the import
            expect(result.postImportAggregates.liquidityAfter).toBe(500_000n);
        });

        // ----------------------------------------------------------------------
        // 2. fetchStakingVaultLogs: 7 parallel getLogs calls
        // ----------------------------------------------------------------------
        it('fetchStakingVaultLogs — issues 7 parallel getLogs calls (one per event signature)', async () => {
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
                // Provide a VaultCreated record so resolveFromBlock can find a birth block
                vaultCreatedLogs: [{
                    address: FACTORY_ADDRESS,
                    topics: [
                        keccak256(toBytes('VaultCreated(address,address)')),
                        pad(OWNER_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                        pad(VAULT_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                    ],
                    data: '0x', blockNumber: 50n, blockHash: '0xblkBirth',
                    transactionHash: '0xtxBirth', transactionIndex: 0, logIndex: 0, removed: false,
                }],
            });
            const evmConfig = makeEvmConfig(client);

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);

            // First getLogs is the VaultCreated factory lookup, then 7 vault-event calls.
            const eventNames = client.getLogs.mock.calls.map(
                (c) => (c[0] as { event?: { name: string } }).event?.name,
            );
            const vaultEventCalls = eventNames.filter((n) => n !== 'VaultCreated');
            expect(vaultEventCalls.sort()).toEqual([
                'ClaimRewards',
                'FlashCloseInitiated',
                'PartialUnstakeBpsSet',
                'Stake',
                'Swap',
                'Unstake',
                'YieldTargetSet',
            ]);
        });

        // ----------------------------------------------------------------------
        // 3. populateChainContext branches
        // ----------------------------------------------------------------------
        it('populateChainContext — Stake reads vault.state at block-1 + NFPM liquidity at block', async () => {
            const stakeRaw = makeStakeLog(100n, '0xtxS', '0xblkS', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 0n }, // ignored — re-fetched
            });
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [toViemLog(stakeRaw)],
                    YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
                vaultStateByBlock: { '99': 0 /* Empty */ },
                nfpmLiquidityByBlock: { '100': 1_000_000n },
                vaultCreatedLogs: [{
                    address: FACTORY_ADDRESS,
                    topics: [
                        keccak256(toBytes('VaultCreated(address,address)')),
                        pad(OWNER_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                        pad(VAULT_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                    ],
                    data: '0x', blockNumber: 50n, blockHash: '0xblkBirth',
                    transactionHash: '0xtxBirth', transactionIndex: 0, logIndex: 0, removed: false,
                }],
            });
            const evmConfig = makeEvmConfig(client);

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);

            // Verify the contract reads happened on the right blocks.
            const reads = client.readContract.mock.calls.map((c) => c[0]);
            const stateRead = reads.find((r: any) => r.functionName === 'state');
            expect(stateRead?.blockNumber).toBe(99n);
            const positionsRead = reads.find((r: any) => r.functionName === 'positions');
            expect(positionsRead?.blockNumber).toBe(100n);

            const dep = fake.store[0]!;
            expect((dep.config as any).liquidityAfter).toBe('1000000');
            expect((dep.state as any).isInitial).toBe(true);
        });

        it('populateChainContext — Swap reads stakedBefore + buffer deltas + NFPM liquidity', async () => {
            // Pre-populate a STAKING_DEPOSIT so Swap is not the first event
            const stake = makeStakeLog(100n, '0xtxA', '0xblkA', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake], poolPriceService,
            );
            mockCreateAndPublish.mockReset();

            const swapRaw = makeSwapLog(200n, '0xtxB', '0xblkB', 0, {
                tokenIn: TOKEN1, amountIn: 0n, tokenOut: TOKEN0, amountOut: 0n,
                effectiveBps: 5000,
                chainContext: { liquidityAfter: 0n, stakedBaseBefore: 0n, stakedQuoteBefore: 0n,
                                rewardBufferBaseDelta: 0n, rewardBufferQuoteDelta: 0n }, // ignored
            });
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [toViemLog(swapRaw)],
                    Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
                vaultUintByFnAndBlock: {
                    stakedBase: { '199': 1000n },
                    stakedQuote: { '199': 500n },
                    rewardBufferBase: { '199': 0n, '200': 50n },
                    rewardBufferQuote: { '199': 0n, '200': 25n },
                },
                nfpmLiquidityByBlock: { '200': 500_000n },
            });
            const evmConfig = makeEvmConfig(client);

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);

            const dispose = fake.store.find((e) => e.eventType === 'STAKING_DISPOSE')!;
            const cfg = dispose.config as any;
            expect(cfg.principalBaseDelta).toBe('500'); // 1000 × 5000/10000
            expect(cfg.principalQuoteDelta).toBe('250'); // 500 × 5000/10000
            expect(cfg.yieldBaseDelta).toBe('50');
            expect(cfg.yieldQuoteDelta).toBe('25');
            expect(cfg.liquidityAfter).toBe('500000');
        });

        // ----------------------------------------------------------------------
        // 4. resolveFromBlock — no prior event → factory VaultCreated lookup
        // ----------------------------------------------------------------------
        it('resolveFromBlock — uses factory VaultCreated event when no prior ledger event', async () => {
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
                vaultCreatedLogs: [{
                    address: FACTORY_ADDRESS,
                    topics: [
                        keccak256(toBytes('VaultCreated(address,address)')),
                        pad(OWNER_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                        pad(VAULT_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                    ],
                    data: '0x', blockNumber: 12345n, blockHash: '0xblkBirth',
                    transactionHash: '0xtxBirth', transactionIndex: 0, logIndex: 0, removed: false,
                }],
            });
            const evmConfig = makeEvmConfig(client);

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);

            // The vault-event getLogs should have used fromBlock = 12345n.
            const stakeCall = client.getLogs.mock.calls.find(
                (c) => (c[0] as { event?: { name: string } }).event?.name === 'Stake',
            );
            expect((stakeCall?.[0] as { fromBlock: bigint }).fromBlock).toBe(12345n);
        });

        // ----------------------------------------------------------------------
        // 5. resolveFromBlock — with prior event → MIN(finalized, lastEvent.block)
        // ----------------------------------------------------------------------
        it('resolveFromBlock — uses MIN(finalizedBlock, lastEventBlock) when a prior event exists', async () => {
            // Pre-populate a stake at block 500 in fake.store via importLogsForPosition
            const stake = makeStakeLog(500n, '0xtxA', '0xblkA', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake], poolPriceService,
            );
            mockCreateAndPublish.mockReset();

            // Case A: finalized > lastEvent.block → use lastEvent.block (500)
            const clientA = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
            });
            await service.syncFromChain(makePosition(), makeEvmConfig(clientA), poolPriceService);
            const stakeCallA = clientA.getLogs.mock.calls.find(
                (c) => (c[0] as { event?: { name: string } }).event?.name === 'Stake',
            );
            expect((stakeCallA?.[0] as { fromBlock: bigint }).fromBlock).toBe(500n);

            // Case B: finalized < lastEvent.block → use finalized (300)
            const clientB = makeMockClient({
                finalizedBlock: 300n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
            });
            await service.syncFromChain(makePosition(), makeEvmConfig(clientB), poolPriceService);
            const stakeCallB = clientB.getLogs.mock.calls.find(
                (c) => (c[0] as { event?: { name: string } }).event?.name === 'Stake',
            );
            expect((stakeCallB?.[0] as { fromBlock: bigint }).fromBlock).toBe(300n);

            // Case C: finality.type === 'blockHeight' (L2 path — Arbitrum/Base).
            // currentBlock=600, minBlockHeight=100 → derived finalized = 500.
            // lastEvent.block = 500 → MIN(500, 500) = 500.
            const clientC = makeMockClient({
                currentBlock: 600n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
            });
            await service.syncFromChain(
                makePosition(),
                makeEvmConfig(clientC, { type: 'blockHeight', minBlockHeight: 100 }),
                poolPriceService,
            );
            const stakeCallC = clientC.getLogs.mock.calls.find(
                (c) => (c[0] as { event?: { name: string } }).event?.name === 'Stake',
            );
            expect((stakeCallC?.[0] as { fromBlock: bigint }).fromBlock).toBe(500n);
            // Sanity: the blockHeight branch uses getBlockNumber (not getBlock)
            expect(clientC.getBlockNumber).toHaveBeenCalled();
            expect(clientC.getBlock).not.toHaveBeenCalled();

            // Case D: same blockHeight finality, but currentBlock - minBlockHeight < lastEvent.block
            // → MIN(derived finalized, lastEvent.block) picks the derived finalized.
            // currentBlock=400, minBlockHeight=200 → derived = 200; lastEvent.block=500 → MIN=200.
            const clientD = makeMockClient({
                currentBlock: 400n,
                logsByEventName: {
                    Stake: [], YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
            });
            await service.syncFromChain(
                makePosition(),
                makeEvmConfig(clientD, { type: 'blockHeight', minBlockHeight: 200 }),
                poolPriceService,
            );
            const stakeCallD = clientD.getLogs.mock.calls.find(
                (c) => (c[0] as { event?: { name: string } }).event?.name === 'Stake',
            );
            expect((stakeCallD?.[0] as { fromBlock: bigint }).fromBlock).toBe(200n);
        });

        // ----------------------------------------------------------------------
        // 6. Reorg revert publishing
        // ----------------------------------------------------------------------
        it('reorg — removed:true log triggers position.liquidity.reverted publish', async () => {
            // Pre-populate one stake event so there's something to revert
            const stake = makeStakeLog(100n, '0xtxA', '0xblkA', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake], poolPriceService,
            );
            mockCreateAndPublish.mockReset();

            // Now sync sees the same log returned by getLogs but flagged removed
            const removedLog = { ...toViemLog(stake), removed: true };
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [removedLog],
                    YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
            });
            await service.syncFromChain(makePosition(), makeEvmConfig(client), poolPriceService);

            // Expect exactly one revert publish, no insert publish.
            expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
            const call = mockCreateAndPublish.mock.calls[0]![0];
            expect(call.type).toBe('position.liquidity.reverted');
            expect(call.payload.blockHash).toBe('0xblkA');
            expect(call.payload.deletedCount).toBe(1);
            expect(fake.store.length).toBe(0);
        });

        // ----------------------------------------------------------------------
        // 7. Marker event — no domain event publish
        // ----------------------------------------------------------------------
        it('marker — YieldTargetSet inserts a ledger row but does NOT publish a domain event', async () => {
            // Pre-stake so liquidityAfter is meaningful for the marker
            const stake = makeStakeLog(100n, '0xtxA', '0xblkA', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake], poolPriceService,
            );
            mockCreateAndPublish.mockReset();

            const ytRaw = makeYieldTargetSetLog(150n, '0xtxYT', '0xblkYT', 0, {
                oldTarget: 0n, newTarget: 999n,
            });
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [],
                    YieldTargetSet: [toViemLog(ytRaw)],
                    PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
            });
            await service.syncFromChain(makePosition(), makeEvmConfig(client), poolPriceService);

            const ytRow = fake.store.find((e) => e.eventType === 'STAKING_YIELD_TARGET_SET');
            expect(ytRow).toBeDefined();
            expect(mockCreateAndPublish).not.toHaveBeenCalled();
        });

        // ----------------------------------------------------------------------
        // 8. Idempotency — second sync with same logs adds no new rows nor publishes
        // ----------------------------------------------------------------------
        it('idempotency — re-running syncFromChain with the same logs is a no-op', async () => {
            const stakeRaw = makeStakeLog(100n, '0xtxA', '0xblkA', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [toViemLog(stakeRaw)],
                    YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [], Unstake: [], ClaimRewards: [], FlashCloseInitiated: [],
                },
                vaultStateByBlock: { '99': 0 },
                nfpmLiquidityByBlock: { '100': 1_000_000n },
                vaultCreatedLogs: [{
                    address: FACTORY_ADDRESS,
                    topics: [
                        keccak256(toBytes('VaultCreated(address,address)')),
                        pad(OWNER_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                        pad(VAULT_ADDRESS.toLowerCase() as `0x${string}`, { size: 32 }),
                    ],
                    data: '0x', blockNumber: 50n, blockHash: '0xblkBirth',
                    transactionHash: '0xtxBirth', transactionIndex: 0, logIndex: 0, removed: false,
                }],
            });
            const evmConfig = makeEvmConfig(client);

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);
            const after1 = fake.store.length;
            const publishes1 = mockCreateAndPublish.mock.calls.length;

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);
            const after2 = fake.store.length;
            const publishes2 = mockCreateAndPublish.mock.calls.length;

            expect(after1).toBe(1);
            expect(after2).toBe(1);          // no new rows
            expect(publishes2).toBe(publishes1); // no new publishes
        });

        // ----------------------------------------------------------------------
        // 9. FlashClose end-to-end via syncFromChain (refinement #3)
        // ----------------------------------------------------------------------
        it('flashClose — FlashCloseInitiated + same-tx Unstake + ClaimRewards → 1 dispose row + 1 decreased event', async () => {
            // Pre-stake so the flashClose dispose has a cost basis to consume
            const stake = makeStakeLog(100n, '0xtxA', '0xblkA', 0, {
                base: 1000n, quote: 500n, yieldTarget: 0n, tokenId: 42n,
                chainContext: { vaultStateBefore: 'Empty', liquidityAfter: 1_000_000n },
            });
            await service.importLogsForPosition(
                POSITION_CONTEXT, CHAIN_ID, OWNER_ADDRESS, [stake], poolPriceService,
            );
            mockCreateAndPublish.mockReset();

            const fci = makeFlashCloseInitiatedLog(200n, '0xtxFC', '0xblkFC', 0, {
                bps: 10000,
                callbackTarget: '0xE5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5E5',
                chainContext: { liquidityAfter: 0n },
            });
            const unstake = makeUnstakeLog(200n, '0xtxFC', '0xblkFC', 1, {
                base: 1000n, quote: 500n,
            });
            const claim = makeClaimRewardsLog(200n, '0xtxFC', '0xblkFC', 2, {
                base: 100n, quote: 50n,
            });

            const client = makeMockClient({
                finalizedBlock: 1_000_000n,
                logsByEventName: {
                    Stake: [],
                    YieldTargetSet: [], PartialUnstakeBpsSet: [],
                    Swap: [],
                    Unstake: [toViemLog(unstake)],
                    ClaimRewards: [toViemLog(claim)],
                    FlashCloseInitiated: [toViemLog(fci)],
                },
                nfpmLiquidityByBlock: { '200': 0n },
            });
            const evmConfig = makeEvmConfig(client);

            await service.syncFromChain(makePosition(), evmConfig, poolPriceService);

            // Exactly 1 STAKING_DISPOSE row (composition succeeded — Unstake/Claim folded)
            const disposes = fake.store.filter((e) => e.eventType === 'STAKING_DISPOSE');
            expect(disposes.length).toBe(1);
            expect((disposes[0]!.state as any).source).toBe('flashClose');

            // Exactly 1 domain event (decreased) — neither Unstake nor ClaimRewards leaks through
            expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
            const call = mockCreateAndPublish.mock.calls[0]![0];
            expect(call.type).toBe('position.liquidity.decreased');
        });
    });
});
