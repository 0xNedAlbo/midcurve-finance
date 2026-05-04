/**
 * UniswapV3StakingPostJournalEntriesRule — unit tests
 *
 * SPEC-0003b PR3 acceptance:
 *  - STAKING_DEPOSIT → lot create + DR 1000 / CR 3000
 *  - STAKING_DISPOSE → 5–6 line balanced entry per lot under Model A
 *    (yield → CR 4000 Fee Income, principal-floor PnL → 4100/5000)
 *  - Lot disposal called with `proceedsReporting = principal-only` (Model A boundary)
 *  - Idempotency at the rule layer
 *  - Reorg + delete handlers are no-ops (FK cascade is the source of truth)
 *  - position.closed posts a zero-out correction against 4300
 *  - Routing key constants smoke test
 *
 * No live RabbitMQ, no live Prisma. Module-level mocks replace the singletons
 * used by the rule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MODULE MOCKS
// =============================================================================

// Mock prisma client used by the rule for direct DB reads.
// Hoisted so it's available before vi.mock's hoisted factory runs.
const { prismaMock } = vi.hoisted(() => ({
    prismaMock: {
        position: { findUnique: vi.fn() },
        positionLedgerEvent: { findFirst: vi.fn(), findMany: vi.fn() },
        token: { upsert: vi.fn(), findUnique: vi.fn() },
        userSettings: { findUnique: vi.fn() },
    },
}));
vi.mock('@midcurve/database', () => ({
    prisma: prismaMock,
}));

import {
    JournalService,
    TokenLotService,
    type DomainEvent,
    type PositionEventType,
    type PositionLifecyclePayload,
    type PositionLedgerEventPayload,
    type PositionLiquidityRevertedPayload,
} from '@midcurve/services';
import { ACCOUNT_CODES } from '@midcurve/shared';
import { UniswapV3StakingPostJournalEntriesRule } from './uniswapv3-staking-post-journal-entries';

// =============================================================================
// FIXTURES
// =============================================================================

const POSITION_ID = 'pos_staking_test';
const USER_ID = 'user_test';
const CHAIN_ID = 42161;
const VAULT_ADDRESS = '0xA1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1';
const FACTORY_ADDRESS = '0xFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFA';
const POOL_ADDRESS = '0xC3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3';
const TOKEN0 = '0xAAAAaaaa00000000000000000000000000000000';
const TOKEN1 = '0xBBBBbbbb00000000000000000000000000000000';
const POSITION_HASH = `uniswapv3-staking/${CHAIN_ID}/${VAULT_ADDRESS}`;
const TOKEN_HASH = `staking-share/${CHAIN_ID}/${VAULT_ADDRESS}`;
const REPORTING_CURRENCY = 'USD';
// Exchange rate scaled 10^8: 1 token = 1 USD
const SPOT_RATE = (1n * 10n ** 8n).toString();
const QUOTE_TOKEN_DECIMALS = 6; // USDC-like
const DECIMALS_SCALE = 10n ** BigInt(QUOTE_TOKEN_DECIMALS);

// =============================================================================
// HELPERS
// =============================================================================

function makeDomainEvent<T>(
    type: PositionEventType,
    payload: T,
    overrides: { id?: string; timestamp?: string } = {},
): DomainEvent<T> {
    return {
        id: overrides.id ?? `evt_${type}_${Date.now()}_${Math.random()}`,
        type,
        entityId: POSITION_ID,
        entityType: 'position',
        userId: USER_ID,
        payload,
        timestamp: overrides.timestamp ?? new Date('2026-04-01T00:00:00Z').toISOString(),
        source: 'business-logic',
    } as unknown as DomainEvent<T>;
}

function makeLedgerEventPayload(ledgerInputHash: string, eventTimestamp = '2026-04-01T00:00:00Z'): PositionLedgerEventPayload {
    return {
        positionId: POSITION_ID,
        positionHash: POSITION_HASH,
        ledgerInputHash,
        eventTimestamp,
    };
}

function makeLifecyclePayload(): PositionLifecyclePayload {
    return {
        positionId: POSITION_ID,
        positionHash: POSITION_HASH,
    } as unknown as PositionLifecyclePayload;
}

interface ConfigurePrismaOpts {
    /** Optional override for the position config; defaults to the standard staking config. */
    positionConfig?: Record<string, unknown>;
    /** Optional override for the position state; defaults to `{ isOwnedByUser: true }`. */
    positionState?: Record<string, unknown>;
    /** ledger event row to return from findFirst */
    ledgerEvent?: {
        id: string;
        deltaCostBasis: string;
        tokenValue: string;
        deltaPnl: string;
        config: Record<string, unknown>;
    };
}

function configurePrismaMocks(opts: ConfigurePrismaOpts = {}): void {
    const positionConfig = opts.positionConfig ?? {
        chainId: CHAIN_ID,
        vaultAddress: VAULT_ADDRESS,
        factoryAddress: FACTORY_ADDRESS,
        poolAddress: POOL_ADDRESS,
        token0Address: TOKEN0,
        token1Address: TOKEN1,
        isToken0Quote: false,
        feeBps: 3000,
        tickSpacing: 60,
        tickLower: -100,
        tickUpper: 100,
    };
    const positionState = opts.positionState ?? { isOwnedByUser: true };

    prismaMock.position.findUnique.mockImplementation(async ({ select }: { select?: Record<string, boolean | object> }) => {
        const base = { id: POSITION_ID, userId: USER_ID, protocol: 'uniswapv3-staking', config: positionConfig, state: positionState };
        if (select?.user) return { ...base, user: { reportingCurrency: REPORTING_CURRENCY } };
        return base;
    });

    if (opts.ledgerEvent) {
        prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(opts.ledgerEvent);
    } else {
        prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);
    }
    prismaMock.positionLedgerEvent.findMany.mockResolvedValue([]);

    prismaMock.token.upsert.mockResolvedValue({ id: 'tok_staking_share', tokenHash: TOKEN_HASH });
    prismaMock.token.findUnique.mockImplementation(async () => ({
        decimals: QUOTE_TOKEN_DECIMALS, coingeckoId: null,
    }));
    prismaMock.userSettings.findUnique.mockResolvedValue({ settings: { costBasisMethod: 'fifo' } });
}

interface MockServices {
    journal: {
        isProcessed: ReturnType<typeof vi.fn>;
        createEntry: ReturnType<typeof vi.fn>;
        getAccountBalance: ReturnType<typeof vi.fn>;
        getAccountBalanceReporting: ReturnType<typeof vi.fn>;
    };
    tokenLot: {
        getOpenLots: ReturnType<typeof vi.fn>;
        createLot: ReturnType<typeof vi.fn>;
        disposeLots: ReturnType<typeof vi.fn>;
    };
}

function installServiceMocks(): MockServices {
    const journal = {
        isProcessed: vi.fn(async () => false),
        createEntry: vi.fn(async () => 'entry_id'),
        getAccountBalance: vi.fn(async () => 0n),
        getAccountBalanceReporting: vi.fn(async () => 0n),
    };
    const tokenLot = {
        getOpenLots: vi.fn(async () => []),
        createLot: vi.fn(async () => 'lot_id'),
        disposeLots: vi.fn(),
    };

    const journalSingleton = JournalService.getInstance();
    Object.assign(journalSingleton, journal);
    const lotSingleton = TokenLotService.getInstance();
    Object.assign(lotSingleton, tokenLot);

    // No CoinGeckoClient mock: prismaMock returns `coingeckoId: null` for tokens,
    // so the rule's getReportingContext never reaches the CoinGecko path.

    return { journal, tokenLot };
}

// =============================================================================
// TESTS
// =============================================================================

describe('UniswapV3StakingPostJournalEntriesRule', () => {
    let rule: UniswapV3StakingPostJournalEntriesRule;
    let mocks: MockServices;

    beforeEach(() => {
        vi.clearAllMocks();
        rule = new UniswapV3StakingPostJournalEntriesRule();
        mocks = installServiceMocks();
        configurePrismaMocks();
    });

    // -------------------------------------------------------------------------
    // 1. Routing pattern smoke test
    // -------------------------------------------------------------------------
    it('binds queue name + routing pattern', () => {
        expect(UniswapV3StakingPostJournalEntriesRule.queueName).toBe(
            'business-logic.uniswapv3-staking-post-journal-entries',
        );
        expect(UniswapV3StakingPostJournalEntriesRule.routingPattern).toBe(
            'positions.*.uniswapv3-staking',
        );
    });

    // -------------------------------------------------------------------------
    // 2. handleLiquidityIncreased — STAKING_DEPOSIT happy path
    // -------------------------------------------------------------------------
    it('STAKING_DEPOSIT → creates lot + DR 1000 / CR 3000 entry', async () => {
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dep1',
                deltaCostBasis: '1500000000', // 1500 USDC at 10^6
                tokenValue: '1500000000',
                deltaPnl: '0',
                config: {
                    deltaL: '1000000',
                    liquidityAfter: '1000000',
                    principalQuoteValue: '0',
                    yieldQuoteValue: '0',
                },
            },
        });

        const event = makeDomainEvent(
            'position.liquidity.increased',
            makeLedgerEventPayload('hash_dep1'),
        );
        await rule.routeEvent(event, 'position.liquidity.increased');

        // Lot created with the right transfer event + quantity
        expect(mocks.tokenLot.createLot).toHaveBeenCalledTimes(1);
        const lotArgs = mocks.tokenLot.createLot.mock.calls[0]![0];
        expect(lotArgs.transferEvent).toBe('STAKING_DEPOSIT');
        expect(lotArgs.quantity).toBe('1000000');
        expect(lotArgs.tokenHash).toBe(TOKEN_HASH);

        // Single balanced journal entry: DR 1000 / CR 3000
        expect(mocks.journal.createEntry).toHaveBeenCalledTimes(1);
        const [, lines] = mocks.journal.createEntry.mock.calls[0]!;
        expect(lines).toHaveLength(2);
        const debit = lines.find((l: { side: string }) => l.side === 'debit')!;
        const credit = lines.find((l: { side: string }) => l.side === 'credit')!;
        expect(debit.accountCode).toBe(ACCOUNT_CODES.LP_POSITION_AT_COST);
        expect(debit.amountQuote).toBe('1500000000');
        expect(credit.accountCode).toBe(ACCOUNT_CODES.CONTRIBUTED_CAPITAL);
        expect(credit.amountQuote).toBe('1500000000');
    });

    // -------------------------------------------------------------------------
    // 3. Token upsert produces correct staking-share hash + metadata
    // -------------------------------------------------------------------------
    it('token upsert uses staking-share hash with correct metadata', async () => {
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dep1',
                deltaCostBasis: '1000000000',
                tokenValue: '1000000000',
                deltaPnl: '0',
                config: { deltaL: '1000000', liquidityAfter: '1000000' },
            },
        });

        await rule.routeEvent(
            makeDomainEvent('position.liquidity.increased', makeLedgerEventPayload('hash1')),
            'position.liquidity.increased',
        );

        expect(prismaMock.token.upsert).toHaveBeenCalledTimes(1);
        const args = prismaMock.token.upsert.mock.calls[0]![0];
        expect(args.where.tokenHash).toBe(TOKEN_HASH);
        expect(args.create.tokenType).toBe('staking-share');
        expect(args.create.symbol).toBe('MSV-STK');
        expect(args.create.decimals).toBe(0);
        expect(args.create.config).toEqual({
            chainId: CHAIN_ID, vaultAddress: VAULT_ADDRESS, protocol: 'uniswapv3-staking',
        });
    });

    // -------------------------------------------------------------------------
    // 4. STAKING_DISPOSE — Model A boundary: proceedsReporting = principal-only
    // -------------------------------------------------------------------------
    it('STAKING_DISPOSE — disposeLots called with proceedsReporting = principal × spotRate / scale (Model A boundary)', async () => {
        // 100% dispose. principal = 1500, yield = 200 (in quote-token units, scaled 10^6)
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dis1',
                deltaCostBasis: '-1500000000',
                tokenValue: '1700000000',
                deltaPnl: '0',
                config: {
                    deltaL: '-1000000',
                    liquidityAfter: '0',
                    principalQuoteValue: '1500000000', // 1500 USDC
                    yieldQuoteValue: '200000000',      // 200 USDC
                },
            },
        });
        mocks.tokenLot.disposeLots.mockResolvedValue({
            disposals: [{
                id: 'd1', lotId: 'lot1',
                quantityDisposed: '1000000',
                proceedsReporting: ((1500n * 10n ** 8n * 10n ** 8n) / DECIMALS_SCALE).toString(),
                costBasisAllocated: ((1500n * 10n ** 8n * 10n ** 8n) / DECIMALS_SCALE).toString(),
                realizedPnl: '0',
            }],
            totalQuantityDisposed: 1000000n,
            totalCostBasisAllocated: 0n,
            totalRealizedPnl: 0n,
        });

        await rule.routeEvent(
            makeDomainEvent('position.liquidity.decreased', makeLedgerEventPayload('hash_dis1')),
            'position.liquidity.decreased',
        );

        expect(mocks.tokenLot.disposeLots).toHaveBeenCalledTimes(1);
        const disposeArgs = mocks.tokenLot.disposeLots.mock.calls[0]![0];
        // Model A boundary: proceedsReporting comes from PRINCIPAL only,
        // not principal+yield. principalQuoteValue is already in quote units
        // (1500 × 10^6 USDC), so reporting = principal × rate / scale =
        // 1500e6 × 1e8 / 1e6 = 1500e8.
        const principalQuote = 1500_000000n;          // 1500 USDC at 6 decimals
        const expectedProceeds = ((principalQuote * BigInt(SPOT_RATE)) / DECIMALS_SCALE).toString();
        expect(disposeArgs.proceedsReporting).toBe(expectedProceeds);
        // Sanity guard: not principal+yield (this is the Model A boundary).
        const yieldQuote = 200_000000n;
        const wrongProceeds = (((principalQuote + yieldQuote) * BigInt(SPOT_RATE)) / DECIMALS_SCALE).toString();
        expect(disposeArgs.proceedsReporting).not.toBe(wrongProceeds);
        expect(disposeArgs.transferEvent).toBe('STAKING_DISPOSE');
        expect(disposeArgs.quantityToDispose).toBe('1000000');
    });

    // -------------------------------------------------------------------------
    // 5. STAKING_DISPOSE — full entry shape (DR 3100, CR 1000, CR 4000, CR 4100)
    // -------------------------------------------------------------------------
    it('STAKING_DISPOSE — entry has DR 3100=principal+yield, CR 1000=cost, CR 4000=yield, CR 4100=pnl', async () => {
        // 100% dispose with principal-floor gain. cost basis = 1000, principal = 1200, yield = 200.
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dis2',
                deltaCostBasis: '-1000000000', // -1000 (cost basis disposed)
                tokenValue: '1400000000',
                deltaPnl: '200000000',
                config: {
                    deltaL: '-1000000',
                    liquidityAfter: '0',
                    principalQuoteValue: '1200000000', // 1200 (gain over cost)
                    yieldQuoteValue: '200000000',      // 200
                },
            },
        });
        mocks.tokenLot.disposeLots.mockResolvedValue({
            disposals: [{
                id: 'd1', lotId: 'lot1',
                quantityDisposed: '1000000',
                proceedsReporting: ((1200n * 10n ** 8n * 10n ** 8n) / DECIMALS_SCALE).toString(),
                costBasisAllocated: ((1000n * 10n ** 8n * 10n ** 8n) / DECIMALS_SCALE).toString(),
                realizedPnl: ((200n * 10n ** 8n * 10n ** 8n) / DECIMALS_SCALE).toString(),
            }],
            totalQuantityDisposed: 1000000n,
            totalCostBasisAllocated: 0n,
            totalRealizedPnl: 0n,
        });

        await rule.routeEvent(
            makeDomainEvent('position.liquidity.decreased', makeLedgerEventPayload('hash_dis2')),
            'position.liquidity.decreased',
        );

        expect(mocks.journal.createEntry).toHaveBeenCalledTimes(1);
        const [, lines] = mocks.journal.createEntry.mock.calls[0]!;

        const byCode = (code: number) =>
            lines.filter((l: { accountCode: number }) => l.accountCode === code);

        const debit3100 = byCode(ACCOUNT_CODES.CAPITAL_RETURNED).find((l: { side: string }) => l.side === 'debit')!;
        expect(debit3100.amountQuote).toBe('1400000000'); // principal 1200 + yield 200

        const credit1000 = byCode(ACCOUNT_CODES.LP_POSITION_AT_COST).find((l: { side: string }) => l.side === 'credit')!;
        expect(credit1000.amountQuote).toBe('1000000000');

        const credit4000 = byCode(ACCOUNT_CODES.FEE_INCOME).find((l: { side: string }) => l.side === 'credit')!;
        expect(credit4000.amountQuote).toBe('200000000');

        const credit4100 = byCode(ACCOUNT_CODES.REALIZED_GAINS).find((l: { side: string }) => l.side === 'credit')!;
        expect(credit4100.amountQuote).toBe('200000000');

        // Sum balance check (in quote units only — FX line has amountQuote=0)
        const sumDebit = lines
            .filter((l: { side: string; amountQuote: string }) => l.side === 'debit')
            .reduce((acc: bigint, l: { amountQuote: string }) => acc + BigInt(l.amountQuote), 0n);
        const sumCredit = lines
            .filter((l: { side: string; amountQuote: string }) => l.side === 'credit')
            .reduce((acc: bigint, l: { amountQuote: string }) => acc + BigInt(l.amountQuote), 0n);
        expect(sumDebit).toBe(sumCredit);
    });

    // -------------------------------------------------------------------------
    // 6. STAKING_DISPOSE — multi-lot proportional split + remainder allocation
    // -------------------------------------------------------------------------
    it('STAKING_DISPOSE — multi-lot dispose: proportional splits sum to ledger totals', async () => {
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dis3',
                deltaCostBasis: '-1000000000',
                tokenValue: '1300000000',
                deltaPnl: '0',
                config: {
                    deltaL: '-1000000',
                    liquidityAfter: '0',
                    principalQuoteValue: '1100000000', // gain
                    yieldQuoteValue: '200000000',
                },
            },
        });
        mocks.tokenLot.disposeLots.mockResolvedValue({
            disposals: [
                {
                    id: 'd1', lotId: 'lot1',
                    quantityDisposed: '300001', // odd to exercise remainder
                    proceedsReporting: '0',
                    costBasisAllocated: '300000000',
                    realizedPnl: '0',
                },
                {
                    id: 'd2', lotId: 'lot2',
                    quantityDisposed: '699999',
                    proceedsReporting: '0',
                    costBasisAllocated: '700000000',
                    realizedPnl: '0',
                },
            ],
            totalQuantityDisposed: 1000000n,
            totalCostBasisAllocated: 0n,
            totalRealizedPnl: 0n,
        });

        await rule.routeEvent(
            makeDomainEvent('position.liquidity.decreased', makeLedgerEventPayload('hash_dis3')),
            'position.liquidity.decreased',
        );

        // Two journal entries — one per lot
        expect(mocks.journal.createEntry).toHaveBeenCalledTimes(2);

        // Sum the proportional principal + yield + costBasis across both entries.
        // They should reconcile EXACTLY with the ledger event totals (last lot gets remainder).
        let totalPrincipalProceeds = 0n;
        let totalYield = 0n;
        let totalCostBasis = 0n;
        for (const call of mocks.journal.createEntry.mock.calls) {
            const lines = call[1] as Array<{ accountCode: number; side: string; amountQuote: string }>;
            const dr3100 = lines.find((l) => l.accountCode === ACCOUNT_CODES.CAPITAL_RETURNED);
            const cr4000 = lines.find((l) => l.accountCode === ACCOUNT_CODES.FEE_INCOME);
            const cr1000 = lines.find((l) => l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST);
            // dr3100 = principal+yield; isolate principal by subtracting yield
            const yieldAmount = cr4000 ? BigInt(cr4000.amountQuote) : 0n;
            const totalProceeds = dr3100 ? BigInt(dr3100.amountQuote) : 0n;
            const principal = totalProceeds - yieldAmount;
            totalPrincipalProceeds += principal;
            totalYield += yieldAmount;
            totalCostBasis += cr1000 ? BigInt(cr1000.amountQuote) : 0n;
        }
        expect(totalPrincipalProceeds).toBe(1100000000n);
        expect(totalYield).toBe(200000000n);
        expect(totalCostBasis).toBe(1000000000n);
    });

    // -------------------------------------------------------------------------
    // 7. Model A: yield-only, flat principal → CR 4000 only, no CR 4100 / DR 5000
    // -------------------------------------------------------------------------
    it('Model A — yield-only, flat principal: entry has CR 4000 but no realized P&L line', async () => {
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dis4',
                deltaCostBasis: '-1000000000',
                tokenValue: '1200000000',
                deltaPnl: '0',
                config: {
                    deltaL: '-1000000', liquidityAfter: '0',
                    principalQuoteValue: '1000000000', // == cost basis → no PnL
                    yieldQuoteValue: '200000000',      // pure yield
                },
            },
        });
        mocks.tokenLot.disposeLots.mockResolvedValue({
            disposals: [{
                id: 'd1', lotId: 'lot1', quantityDisposed: '1000000',
                proceedsReporting: '0', costBasisAllocated: '1000000000', realizedPnl: '0',
            }],
            totalQuantityDisposed: 1000000n, totalCostBasisAllocated: 0n, totalRealizedPnl: 0n,
        });

        await rule.routeEvent(
            makeDomainEvent('position.liquidity.decreased', makeLedgerEventPayload('hash_dis4')),
            'position.liquidity.decreased',
        );

        const [, lines] = mocks.journal.createEntry.mock.calls[0]!;
        // Model A: yield is recognized but no realized PnL line because principal == cost
        expect(lines.some((l: { accountCode: number }) => l.accountCode === ACCOUNT_CODES.FEE_INCOME)).toBe(true);
        expect(lines.some((l: { accountCode: number }) => l.accountCode === ACCOUNT_CODES.REALIZED_GAINS)).toBe(false);
        expect(lines.some((l: { accountCode: number }) => l.accountCode === ACCOUNT_CODES.REALIZED_LOSSES)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // 8. Model A: principal-floor gain, zero yield → CR 4100, no CR 4000
    // -------------------------------------------------------------------------
    it('Model A — principal-floor gain, zero yield: entry has CR 4100 but no Fee Income line', async () => {
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dis5',
                deltaCostBasis: '-1000000000',
                tokenValue: '1200000000',
                deltaPnl: '200000000',
                config: {
                    deltaL: '-1000000', liquidityAfter: '0',
                    principalQuoteValue: '1200000000', // gain over cost
                    yieldQuoteValue: '0',              // no yield
                },
            },
        });
        mocks.tokenLot.disposeLots.mockResolvedValue({
            disposals: [{
                id: 'd1', lotId: 'lot1', quantityDisposed: '1000000',
                proceedsReporting: '0', costBasisAllocated: '1000000000', realizedPnl: '0',
            }],
            totalQuantityDisposed: 1000000n, totalCostBasisAllocated: 0n, totalRealizedPnl: 0n,
        });

        await rule.routeEvent(
            makeDomainEvent('position.liquidity.decreased', makeLedgerEventPayload('hash_dis5')),
            'position.liquidity.decreased',
        );

        const [, lines] = mocks.journal.createEntry.mock.calls[0]!;
        expect(lines.some((l: { accountCode: number }) => l.accountCode === ACCOUNT_CODES.REALIZED_GAINS)).toBe(true);
        expect(lines.some((l: { accountCode: number }) => l.accountCode === ACCOUNT_CODES.FEE_INCOME)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // 9. handleLiquidityReverted — no-op
    // -------------------------------------------------------------------------
    it('position.liquidity.reverted — no service calls (FK cascade is the source of truth)', async () => {
        await rule.routeEvent(
            makeDomainEvent('position.liquidity.reverted', {
                positionId: POSITION_ID,
                positionHash: POSITION_HASH,
                blockHash: '0xblkA',
                deletedCount: 1,
                revertedAt: new Date().toISOString(),
            } as PositionLiquidityRevertedPayload),
            'position.liquidity.reverted',
        );

        expect(mocks.journal.createEntry).not.toHaveBeenCalled();
        expect(mocks.tokenLot.createLot).not.toHaveBeenCalled();
        expect(mocks.tokenLot.disposeLots).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // 10. handlePositionClosed — zero-out correction against 4300
    // -------------------------------------------------------------------------
    it('position.closed — non-zero remainder is zeroed against FX_GAIN_LOSS', async () => {
        // Pretend the 1000 account still has +500 (over-debited): we should CR 1000 / DR 4300
        mocks.journal.getAccountBalance.mockResolvedValue(500_000n);
        mocks.journal.getAccountBalanceReporting.mockResolvedValue(500_00000000n); // 500 USD scaled 10^8

        await rule.routeEvent(
            makeDomainEvent('position.closed', makeLifecyclePayload()),
            'position.closed',
        );

        expect(mocks.journal.createEntry).toHaveBeenCalledTimes(1);
        const [, lines] = mocks.journal.createEntry.mock.calls[0]!;
        const cr1000 = lines.find(
            (l: { accountCode: number; side: string }) =>
                l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST && l.side === 'credit',
        );
        const dr4300 = lines.find(
            (l: { accountCode: number; side: string }) =>
                l.accountCode === ACCOUNT_CODES.FX_GAIN_LOSS && l.side === 'debit',
        );
        expect(cr1000).toBeDefined();
        expect(dr4300).toBeDefined();
        expect(cr1000!.amountQuote).toBe('500000');
    });

    // -------------------------------------------------------------------------
    // 11. handlePositionDeleted — no-op
    // -------------------------------------------------------------------------
    it('position.deleted — no service calls (FK cascade)', async () => {
        await rule.routeEvent(
            makeDomainEvent('position.deleted', makeLifecyclePayload()),
            'position.deleted',
        );

        expect(mocks.journal.createEntry).not.toHaveBeenCalled();
        expect(mocks.tokenLot.createLot).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // 12. Idempotency at the rule layer
    // -------------------------------------------------------------------------
    it('idempotency — second invocation with same domainEventId is a no-op', async () => {
        configurePrismaMocks({
            ledgerEvent: {
                id: 'le_dep_idem',
                deltaCostBasis: '1500000000',
                tokenValue: '1500000000',
                deltaPnl: '0',
                config: { deltaL: '1000000', liquidityAfter: '1000000' },
            },
        });

        // First call: handler proceeds normally.
        const event = makeDomainEvent(
            'position.liquidity.increased',
            makeLedgerEventPayload('hash_idem'),
            { id: 'evt_idem' },
        );
        await rule.routeEvent(event, 'position.liquidity.increased');
        expect(mocks.journal.createEntry).toHaveBeenCalledTimes(1);

        // Second call: isProcessed returns true → handler short-circuits.
        mocks.journal.isProcessed.mockResolvedValueOnce(true);
        await rule.routeEvent(event, 'position.liquidity.increased');
        expect(mocks.journal.createEntry).toHaveBeenCalledTimes(1); // still 1, no new entry
        expect(mocks.tokenLot.createLot).toHaveBeenCalledTimes(1);   // no new lot either
    });
});
