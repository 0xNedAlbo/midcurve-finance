/**
 * UniswapV3StakingPostJournalEntriesRule
 *
 * Subscribes to UniswapV3StakingVault position domain events emitted by
 * `UniswapV3StakingLedgerService.syncFromChain` (PR2), maintains TokenLot
 * rows, and creates double-entry JournalEntry rows under **Model A**:
 * yield is recognized as Fee Income (4000), NOT realized PnL (4100/5000).
 *
 * Acquisition events (create lots + DR 1000 / CR 3000):
 * - position.created             → backfill lots + entries from ledger history
 * - position.liquidity.increased → STAKING_DEPOSIT lot + entry
 *
 * Disposal events (consume lots + DR 3100 / CR 1000 / CR 4000 / CR or DR 4100/5000 / FX):
 * - position.liquidity.decreased → STAKING_DISPOSE: 5–6 line balanced entry per lot
 *
 * Lifecycle / reorg:
 * - position.closed              → cost basis correction (zero 1000 vs 4300)
 * - position.deleted             → no-op (FK cascade)
 * - position.liquidity.reverted  → no-op (FK cascade — reverted ledger events
 *                                   were already deleted upstream by the ledger
 *                                   service before this event fires)
 *
 * Per SPEC §8.5, staking has no transferred.in/out (vaults are owner-bound,
 * non-transferable), no fees.collected (yield is folded into dispose), no
 * burned (vaults reach Settled state, not burned).
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
    setupConsumerQueue,
    CoinGeckoClient,
    findClosestPrice,
    TokenLotService,
    JournalService,
    JournalLineBuilder,
    createLotSelector,
    type DomainEvent,
    type PositionEventType,
    type PositionLifecyclePayload,
    type PositionLedgerEventPayload,
    type PositionLiquidityRevertedPayload,
    type DisposalResult,
} from '@midcurve/services';
import {
    createErc20TokenHash,
    createStakingShareTokenHash,
    ACCOUNT_CODES,
    type JournalLineInput,
    type CostBasisMethod,
    DEFAULT_USER_SETTINGS,
} from '@midcurve/shared';
import { BusinessRule } from '../../base';

// =============================================================================
// Constants
// =============================================================================

const QUEUE_NAME = 'business-logic.uniswapv3-staking-post-journal-entries';
const ROUTING_PATTERN = 'positions.*.uniswapv3-staking';
const FLOAT_TO_BIGINT_SCALE = 1e8;

// =============================================================================
// Types
// =============================================================================

interface ReportingContext {
    reportingCurrency: string;
    exchangeRate: string;
    quoteTokenDecimals: number;
    /** Vault-scoped instrument ref per SPEC §8.3 — `uniswapv3-staking/{chainId}/{vaultAddress}` */
    instrumentRef: string;
}

interface PositionTokenContext {
    tokenId: string;
    tokenHash: string;
}

// =============================================================================
// Rule Implementation
// =============================================================================

export class UniswapV3StakingPostJournalEntriesRule extends BusinessRule {
    readonly ruleName = 'uniswapv3-staking-post-journal-entries';
    readonly ruleDescription =
        'Maintains token lots and journal entries from UniswapV3StakingVault position domain events (Model A — yield → Fee Income)';

    private consumerTag: string | null = null;
    private readonly tokenLotService: TokenLotService;
    private readonly journalService: JournalService;

    constructor() {
        super();
        this.tokenLotService = TokenLotService.getInstance();
        this.journalService = JournalService.getInstance();
    }

    /** Smoke-testable accessors so tests can verify the routing-key constants. */
    static get queueName(): string {
        return QUEUE_NAME;
    }

    static get routingPattern(): string {
        return ROUTING_PATTERN;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected async onStartup(): Promise<void> {
        if (!this.channel) throw new Error('No channel available');

        await setupConsumerQueue(this.channel, QUEUE_NAME, ROUTING_PATTERN);
        await this.channel.prefetch(1);

        const result = await this.channel.consume(
            QUEUE_NAME,
            (msg) => this.handleMessage(msg),
            { noAck: false },
        );

        this.consumerTag = result.consumerTag;
        this.logger.info(
            { queueName: QUEUE_NAME, routingPattern: ROUTING_PATTERN },
            'Subscribed to UniswapV3 staking-vault position events',
        );
    }

    protected async onShutdown(): Promise<void> {
        if (this.consumerTag && this.channel) {
            await this.channel.cancel(this.consumerTag);
            this.consumerTag = null;
        }
    }

    // =========================================================================
    // Message Routing
    // =========================================================================

    private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
        if (!msg || !this.channel) return;

        try {
            const event = JSON.parse(msg.content.toString()) as DomainEvent;
            const eventType = event.type as PositionEventType;

            this.logger.info(
                { eventId: event.id, eventType, entityId: event.entityId },
                'Processing staking-vault position event',
            );

            await this.routeEvent(event, eventType);
            this.channel.ack(msg);
        } catch (error) {
            this.logger.error(
                { error: error instanceof Error ? error.message : String(error) },
                'Error processing staking-vault position event',
            );
            this.channel.nack(msg, false, false);
        }
    }

    /** Routes a domain event to the appropriate handler. Public so tests can drive it. */
    public async routeEvent(
        event: DomainEvent,
        eventType: PositionEventType,
    ): Promise<void> {
        switch (eventType) {
            case 'position.created':
                return this.handlePositionCreated(event as DomainEvent<PositionLifecyclePayload>);
            case 'position.liquidity.increased':
                return this.handleLiquidityIncreased(event as DomainEvent<PositionLedgerEventPayload>);
            case 'position.liquidity.decreased':
                return this.handleLiquidityDecreased(event as DomainEvent<PositionLedgerEventPayload>);
            case 'position.closed':
                return this.handlePositionClosed(event as DomainEvent<PositionLifecyclePayload>);
            case 'position.deleted':
                return this.handlePositionDeleted(event as DomainEvent<PositionLifecyclePayload>);
            case 'position.liquidity.reverted':
                return this.handleLiquidityReverted(event as DomainEvent<PositionLiquidityRevertedPayload>);
            // Staking has no transferred.in/out, no fees.collected, no burned (per SPEC §8.5).
            case 'position.transferred.in':
            case 'position.transferred.out':
            case 'position.fees.collected':
            case 'position.burned':
                this.logger.debug(
                    { eventType },
                    'Event type not applicable to uniswapv3-staking, skipping',
                );
                return;
            default:
                this.logger.warn({ eventType }, 'Unknown position event type, skipping');
        }
    }

    // =========================================================================
    // Acquisition: STAKING_DEPOSIT
    // =========================================================================

    /**
     * `position.created` → replay all STAKING_DEPOSIT and STAKING_DISPOSE
     * ledger events in chain order. Idempotent via per-event composite hash.
     */
    private async handlePositionCreated(
        event: DomainEvent<PositionLifecyclePayload>,
    ): Promise<void> {
        const { positionId, positionHash } = event.payload;

        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: { id: true, userId: true, protocol: true, config: true, state: true },
        });
        if (!position) {
            this.logger.warn({ positionId }, 'Position not found for position.created');
            return;
        }

        // Ownership guard — staking vaults are bound to their owner; if the user
        // no longer owns the wallet (e.g. wallet removed), skip backfill.
        const positionState = position.state as Record<string, unknown>;
        if (positionState.isOwnedByUser === false) {
            this.logger.info({ positionHash }, 'Skipping backfill — staking vault not owned by user');
            return;
        }

        const tokenCtx = await this.resolvePositionToken(positionId);
        if (!tokenCtx) return;

        // Idempotency: if any lots already exist for this position, treat as
        // already backfilled.
        const existingLots = await this.tokenLotService.getOpenLots(position.userId, tokenCtx.tokenHash);
        if (existingLots.length > 0) {
            this.logger.info({ positionHash }, 'Lots already exist for staking vault, skipping backfill');
            return;
        }

        const costBasisMethod = await this.getUserCostBasisMethod(position.userId);
        const lotSelector = createLotSelector(costBasisMethod);

        const ledgerEvents = await prisma.positionLedgerEvent.findMany({
            where: {
                positionId,
                eventType: { in: ['STAKING_DEPOSIT', 'STAKING_DISPOSE'] },
                isIgnored: false,
            },
            select: {
                id: true, eventType: true, inputHash: true, timestamp: true,
                tokenValue: true, deltaCostBasis: true, deltaPnl: true, config: true,
            },
            orderBy: { timestamp: 'asc' },
        });

        if (ledgerEvents.length === 0) return;

        const positionConfig = position.config as Record<string, unknown>;
        const chainId = positionConfig.chainId as number;
        const vaultAddress = positionConfig.vaultAddress as string;
        const positionRef = positionHash;
        const instrumentRef = `uniswapv3-staking/${chainId}/${vaultAddress}`;

        const { reportingCurrency, quoteTokenDecimals, quoteCoingeckoId } =
            await this.getQuoteTokenInfo(positionId);

        // Fetch historic price time series spanning the full event range.
        let priceTimeSeries: [number, number][] = [];
        if (quoteCoingeckoId) {
            const firstTs = Math.floor(ledgerEvents[0]!.timestamp.getTime() / 1000);
            const lastTs = Math.floor(ledgerEvents[ledgerEvents.length - 1]!.timestamp.getTime() / 1000);
            const chartData = await CoinGeckoClient.getInstance().getMarketChartRange(
                quoteCoingeckoId, firstTs - 3600, lastTs + 3600,
            );
            priceTimeSeries = chartData.prices;
        }

        for (const le of ledgerEvents) {
            const config = le.config as Record<string, unknown>;
            const deltaL = config.deltaL as string;
            if (!deltaL || deltaL === '0') continue;

            const eventRate = computeHistoricRate(quoteCoingeckoId, priceTimeSeries, le.timestamp);
            const eventRateStr = eventRate.toString();

            const domainEventId = `${event.id}:${le.inputHash}`;
            if (await this.journalService.isProcessed(domainEventId)) continue;

            if (le.eventType === 'STAKING_DEPOSIT') {
                if (le.deltaCostBasis === '0') continue;
                const costBasisAbsolute = computeReportingAmount(
                    le.deltaCostBasis, eventRateStr, quoteTokenDecimals,
                );

                const lotId = await this.tokenLotService.createLot({
                    userId: position.userId,
                    tokenId: tokenCtx.tokenId,
                    tokenHash: tokenCtx.tokenHash,
                    quantity: deltaL,
                    costBasisAbsolute,
                    acquiredAt: le.timestamp,
                    acquisitionEventId: le.inputHash,
                    positionLedgerEventId: le.id,
                    transferEvent: 'STAKING_DEPOSIT',
                });

                await this.createAcquisitionEntry(
                    position.userId, domainEventId,
                    'position.liquidity.increased',
                    le.id, le.timestamp, le.deltaCostBasis,
                    lotId, positionRef, instrumentRef,
                    reportingCurrency, eventRateStr, quoteTokenDecimals,
                );
            } else if (le.eventType === 'STAKING_DISPOSE') {
                const principalQuoteValue = (config.principalQuoteValue as string) ?? '0';
                const yieldQuoteValue = (config.yieldQuoteValue as string) ?? '0';
                // Model A: only principal flows through the disposal mechanism.
                const proceedsReporting = computeReportingAmount(
                    principalQuoteValue, eventRateStr, quoteTokenDecimals,
                );

                // STAKING_DISPOSE deltaL is signed negative — quantityToDispose is its absolute value.
                const quantityToDispose = absBigint(deltaL);

                const result = await this.tokenLotService.disposeLots({
                    userId: position.userId,
                    tokenHash: tokenCtx.tokenHash,
                    quantityToDispose,
                    proceedsReporting,
                    disposedAt: le.timestamp,
                    disposalEventId: le.inputHash,
                    positionLedgerEventId: le.id,
                    transferEvent: 'STAKING_DISPOSE',
                    lotSelector,
                });

                await this.createDisposalEntries(
                    position.userId, domainEventId,
                    'position.liquidity.decreased',
                    le.id, le.timestamp,
                    le.deltaCostBasis, principalQuoteValue, yieldQuoteValue,
                    result, positionRef, instrumentRef,
                    reportingCurrency, eventRateStr, quoteTokenDecimals,
                );
            }
        }

        this.logger.info(
            { positionHash, eventsProcessed: ledgerEvents.length },
            'Token lots and journal entries backfilled from staking-vault ledger history',
        );
    }

    /**
     * `position.liquidity.increased` (STAKING_DEPOSIT) → create one lot,
     * post one balanced entry: DR 1000 / CR 3000.
     */
    private async handleLiquidityIncreased(
        event: DomainEvent<PositionLedgerEventPayload>,
    ): Promise<void> {
        if (await this.journalService.isProcessed(event.id)) return;

        const { positionId, positionHash, ledgerInputHash } = event.payload;
        const userId = await this.getPositionUserId(positionId);

        const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
        if (!ledgerEvent) {
            this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for STAKING_DEPOSIT');
            return;
        }

        const config = ledgerEvent.config as Record<string, unknown>;
        const deltaL = config.deltaL as string;
        if (!deltaL || deltaL === '0') return;

        const deltaCostBasis = ledgerEvent.deltaCostBasis;
        if (deltaCostBasis === '0') return;

        const ctx = await this.getReportingContext(positionId);
        const tokenCtx = await this.resolvePositionToken(positionId);
        if (!tokenCtx) return;

        const costBasisAbsolute = computeReportingAmount(
            deltaCostBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
        );

        const lotId = await this.tokenLotService.createLot({
            userId,
            tokenId: tokenCtx.tokenId,
            tokenHash: tokenCtx.tokenHash,
            quantity: deltaL,
            costBasisAbsolute,
            acquiredAt: new Date(event.payload.eventTimestamp),
            acquisitionEventId: ledgerInputHash,
            positionLedgerEventId: ledgerEvent.id,
            transferEvent: 'STAKING_DEPOSIT',
        });

        await this.createAcquisitionEntry(
            userId, event.id, event.type,
            ledgerEvent.id, new Date(event.payload.eventTimestamp), deltaCostBasis,
            lotId, positionHash, ctx.instrumentRef,
            ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
        );
    }

    // =========================================================================
    // Disposal: STAKING_DISPOSE — Model A divergence
    // =========================================================================

    /**
     * `position.liquidity.decreased` (STAKING_DISPOSE) → consume lots and
     * post a balanced 5–6 line entry per disposed lot.
     *
     * Follows SPEC-0003b §8.4 rev. b — balanced disposal entry
     * (DR 3100 = principal + yield). Yield is recognized as Fee Income (4000),
     * NOT folded into realized PnL — that's the Model A invariant.
     */
    private async handleLiquidityDecreased(
        event: DomainEvent<PositionLedgerEventPayload>,
    ): Promise<void> {
        if (await this.journalService.isProcessed(event.id)) return;

        const { positionId, positionHash, ledgerInputHash } = event.payload;
        const userId = await this.getPositionUserId(positionId);

        const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
        if (!ledgerEvent) {
            this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for STAKING_DISPOSE');
            return;
        }

        const config = ledgerEvent.config as Record<string, unknown>;
        const deltaL = config.deltaL as string;
        if (!deltaL || deltaL === '0') return;

        const principalQuoteValue = (config.principalQuoteValue as string) ?? '0';
        const yieldQuoteValue = (config.yieldQuoteValue as string) ?? '0';

        const ctx = await this.getReportingContext(positionId);
        const tokenCtx = await this.resolvePositionToken(positionId);
        if (!tokenCtx) return;

        const costBasisMethod = await this.getUserCostBasisMethod(userId);
        const lotSelector = createLotSelector(costBasisMethod);

        // Model A boundary: pass principal-only as proceeds so per-lot
        // realizedPnl reflects principal vs cost basis, not yield.
        const proceedsReporting = computeReportingAmount(
            principalQuoteValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
        );

        const quantityToDispose = absBigint(deltaL);

        const result = await this.tokenLotService.disposeLots({
            userId,
            tokenHash: tokenCtx.tokenHash,
            quantityToDispose,
            proceedsReporting,
            disposedAt: new Date(event.payload.eventTimestamp),
            disposalEventId: ledgerInputHash,
            positionLedgerEventId: ledgerEvent.id,
            transferEvent: 'STAKING_DISPOSE',
            lotSelector,
        });

        await this.createDisposalEntries(
            userId, event.id, event.type,
            ledgerEvent.id, new Date(event.payload.eventTimestamp),
            ledgerEvent.deltaCostBasis, principalQuoteValue, yieldQuoteValue,
            result, positionHash, ctx.instrumentRef,
            ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
        );
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * `position.closed` → zero out remaining cost basis on the 1000 account
     * against 4300 (FX_GAIN_LOSS). Mirrors NFT/Vault pattern verbatim.
     */
    private async handlePositionClosed(
        event: DomainEvent<PositionLifecyclePayload>,
    ): Promise<void> {
        const { positionId, positionHash } = event.payload;
        const positionRef = positionHash;

        const correctionEventId = `${event.id}:cost-basis-correction`;
        if (await this.journalService.isProcessed(correctionEventId)) return;

        const cbQuote = await this.journalService.getAccountBalance(
            ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef,
        );
        const cbReporting = await this.journalService.getAccountBalanceReporting(
            ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef,
        );

        if (cbQuote === 0n && cbReporting === 0n) return;

        const userId = await this.getPositionUserId(positionId);
        const ctx = await this.getReportingContext(positionId);
        const absQuote = absBigintValue(cbQuote).toString();
        const absReporting = absBigintValue(cbReporting).toString();
        const isOverCredited = cbQuote < 0n || (cbQuote === 0n && cbReporting < 0n);

        const lines: JournalLineInput[] = isOverCredited
            ? [
                {
                    accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'debit',
                    amountQuote: absQuote, amountReporting: absReporting,
                    reportingCurrency: ctx.reportingCurrency, exchangeRate: ctx.exchangeRate,
                    positionRef, instrumentRef: ctx.instrumentRef,
                },
                {
                    accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'credit',
                    amountQuote: absQuote, amountReporting: absReporting,
                    reportingCurrency: ctx.reportingCurrency, exchangeRate: ctx.exchangeRate,
                    positionRef, instrumentRef: ctx.instrumentRef,
                },
            ]
            : [
                {
                    accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'credit',
                    amountQuote: absQuote, amountReporting: absReporting,
                    reportingCurrency: ctx.reportingCurrency, exchangeRate: ctx.exchangeRate,
                    positionRef, instrumentRef: ctx.instrumentRef,
                },
                {
                    accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'debit',
                    amountQuote: absQuote, amountReporting: absReporting,
                    reportingCurrency: ctx.reportingCurrency, exchangeRate: ctx.exchangeRate,
                    positionRef, instrumentRef: ctx.instrumentRef,
                },
            ];

        await this.journalService.createEntry(
            {
                userId,
                domainEventId: correctionEventId,
                domainEventType: event.type,
                entryDate: new Date(event.timestamp),
                description: `Staking-vault cost basis correction: ${positionRef}`,
            },
            lines,
        );
    }

    /** `position.deleted` → no-op. FK cascade cleans up lots/disposals/entries. */
    private async handlePositionDeleted(
        event: DomainEvent<PositionLifecyclePayload>,
    ): Promise<void> {
        this.logger.info(
            { positionHash: event.payload.positionHash },
            'Staking-vault position deleted — lots, disposals, and journal entries cascade-deleted via FK',
        );
    }

    /**
     * `position.liquidity.reverted` → no-op. The reverted PositionLedgerEvent
     * row was already deleted upstream by `UniswapV3StakingLedgerService`,
     * which cascades to TokenLot / TokenLotDisposal / JournalEntry via FK.
     */
    private async handleLiquidityReverted(
        event: DomainEvent<PositionLiquidityRevertedPayload>,
    ): Promise<void> {
        this.logger.info(
            { positionHash: event.payload.positionHash, blockHash: event.payload.blockHash },
            'Staking-vault liquidity reverted — lots, disposals, and journal entries cascade-deleted via FK',
        );
    }

    // =========================================================================
    // Journal Entry Builders
    // =========================================================================

    private async createAcquisitionEntry(
        userId: string, domainEventId: string, domainEventType: string,
        positionLedgerEventId: string, entryDate: Date, deltaCostBasis: string,
        tokenLotId: string, positionRef: string, instrumentRef: string,
        reportingCurrency: string, exchangeRate: string, quoteTokenDecimals: number,
    ): Promise<void> {
        const lines = new JournalLineBuilder()
            .withReporting(reportingCurrency, exchangeRate, quoteTokenDecimals)
            .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, deltaCostBasis, positionRef, instrumentRef)
            .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, deltaCostBasis, positionRef, instrumentRef)
            .build();

        await this.journalService.createEntry(
            {
                userId, domainEventId, domainEventType, positionLedgerEventId, entryDate,
                tokenLotId, description: `Staking-vault acquisition: ${positionRef}`,
            },
            lines,
        );
    }

    /**
     * Build one balanced disposal entry per disposed lot (Model A).
     *
     * Follows SPEC-0003b §8.4 rev. b — balanced disposal entry
     * (DR 3100 = principal + yield). Yield → Fee Income (4000), realized
     * PnL is principal-vs-cost-basis only.
     *
     *     DR 3100 Capital Returned    = proportionalPrincipal + proportionalYield
     *     CR 1000 LP Position at Cost = proportionalCostBasis
     *     CR 4000 Fee Income          = proportionalYield                  // Model A
     *     IF proportionalPnl > 0: CR 4100 Realized Gains
     *     IF proportionalPnl < 0: DR 5000 Realized Losses
     *     FX adjustment line if fxDiff != 0 (against 4300, amountQuote=0)
     *
     * Proportional split is by quantity; the last lot gets the remainder so
     * the per-lot sums reconcile exactly with the ledger event totals.
     */
    private async createDisposalEntries(
        userId: string, domainEventId: string, domainEventType: string,
        positionLedgerEventId: string, entryDate: Date,
        ledgerDeltaCostBasis: string,
        ledgerPrincipalQuoteValue: string,
        ledgerYieldQuoteValue: string,
        result: DisposalResult,
        positionRef: string, instrumentRef: string,
        reportingCurrency: string, exchangeRate: string, quoteTokenDecimals: number,
    ): Promise<void> {
        const totalQtyDisposed = result.totalQuantityDisposed;
        const absDeltaCostBasis = BigInt(absBigint(ledgerDeltaCostBasis));
        const totalPrincipal = BigInt(ledgerPrincipalQuoteValue);
        const totalYield = BigInt(ledgerYieldQuoteValue);
        const decimalsScale = 10n ** BigInt(quoteTokenDecimals);
        const spotRate = BigInt(exchangeRate);

        let costBasisDistributed = 0n;
        let principalDistributed = 0n;
        let yieldDistributed = 0n;

        for (let i = 0; i < result.disposals.length; i++) {
            const d = result.disposals[i]!;
            const isLast = i === result.disposals.length - 1;
            const qty = BigInt(d.quantityDisposed);

            const proportionalCostBasis = isLast
                ? absDeltaCostBasis - costBasisDistributed
                : (qty * absDeltaCostBasis) / totalQtyDisposed;
            const proportionalPrincipal = isLast
                ? totalPrincipal - principalDistributed
                : (qty * totalPrincipal) / totalQtyDisposed;
            const proportionalYield = isLast
                ? totalYield - yieldDistributed
                : (qty * totalYield) / totalQtyDisposed;
            const proportionalPnl = proportionalPrincipal - proportionalCostBasis;

            costBasisDistributed += proportionalCostBasis;
            principalDistributed += proportionalPrincipal;
            yieldDistributed += proportionalYield;

            const builder = new JournalLineBuilder()
                .withReporting(reportingCurrency, exchangeRate, quoteTokenDecimals);

            // DR 3100 = principal + yield (full proceeds returned to wallet).
            const totalProceeds = proportionalPrincipal + proportionalYield;
            if (totalProceeds > 0n) {
                builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalProceeds.toString(), positionRef, instrumentRef);
            }

            // CR 1000 = lot cost basis.
            if (proportionalCostBasis > 0n) {
                builder.credit(ACCOUNT_CODES.LP_POSITION_AT_COST, proportionalCostBasis.toString(), positionRef, instrumentRef);
            }

            // CR 4000 = yield (Model A: fee income, NOT realized PnL).
            if (proportionalYield > 0n) {
                builder.credit(ACCOUNT_CODES.FEE_INCOME, proportionalYield.toString(), positionRef, instrumentRef);
            }

            // CR 4100 / DR 5000 — principal-vs-cost-basis realized PnL.
            if (proportionalPnl > 0n) {
                builder.credit(ACCOUNT_CODES.REALIZED_GAINS, proportionalPnl.toString(), positionRef, instrumentRef);
            } else if (proportionalPnl < 0n) {
                builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, (-proportionalPnl).toString(), positionRef, instrumentRef);
            }

            const lines = builder.build();

            // Override the cost-basis line's amountReporting with the lot's
            // actual cost basis (FX historical), then book any drift to 4300.
            const cbLine = lines.find((l) => l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST);
            if (cbLine) {
                const cbAtSpot = (proportionalCostBasis * spotRate) / decimalsScale;
                const lotCostBasis = BigInt(d.costBasisAllocated);
                cbLine.amountReporting = lotCostBasis.toString();

                const fxDiff = cbAtSpot - lotCostBasis;
                if (fxDiff !== 0n) {
                    lines.push({
                        accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
                        side: fxDiff > 0n ? 'credit' : 'debit',
                        amountQuote: '0',
                        amountReporting: (fxDiff < 0n ? -fxDiff : fxDiff).toString(),
                        reportingCurrency,
                        exchangeRate,
                        positionRef,
                        instrumentRef,
                    });
                }
            }

            await this.journalService.createEntry(
                {
                    userId,
                    domainEventId: `${domainEventId}:${d.id}`,
                    domainEventType,
                    positionLedgerEventId,
                    entryDate,
                    tokenLotDisposalId: d.id,
                    description: `Staking-vault disposal: ${positionRef}`,
                },
                lines,
            );
        }
    }

    // =========================================================================
    // Token Resolution
    // =========================================================================

    /**
     * Resolve (or upsert) the staking-share token for this position.
     * Vaults are owner-bound 1:1, so the vaultAddress alone disambiguates.
     */
    private async resolvePositionToken(positionId: string): Promise<PositionTokenContext | null> {
        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: { config: true },
        });
        if (!position) return null;

        const config = position.config as Record<string, unknown>;
        const chainId = config.chainId as number;
        const vaultAddress = config.vaultAddress as string;
        const tokenHash = createStakingShareTokenHash(chainId, vaultAddress);

        const token = await prisma.token.upsert({
            where: { tokenHash },
            update: {},
            create: {
                tokenType: 'staking-share',
                name: `Midcurve Staking Vault (${vaultAddress.slice(0, 6)}…${vaultAddress.slice(-4)})`,
                symbol: 'MSV-STK',
                decimals: 0,
                tokenHash,
                config: { chainId, vaultAddress, protocol: 'uniswapv3-staking' },
            },
            select: { id: true, tokenHash: true },
        });

        return { tokenId: token.id, tokenHash: token.tokenHash };
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private async findLedgerEventByInputHash(positionId: string, inputHash: string) {
        return prisma.positionLedgerEvent.findFirst({
            where: { positionId, inputHash },
            select: {
                id: true, deltaCostBasis: true, costBasisAfter: true,
                deltaPnl: true, pnlAfter: true, deltaCollectedYield: true,
                collectedYieldAfter: true, tokenValue: true, config: true,
            },
        });
    }

    private async getPositionUserId(positionId: string): Promise<string> {
        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: { userId: true },
        });
        if (!position) throw new Error(`Position not found: ${positionId}`);
        return position.userId;
    }

    private async getUserCostBasisMethod(userId: string): Promise<CostBasisMethod> {
        const settings = await prisma.userSettings.findUnique({
            where: { userId },
            select: { settings: true },
        });
        if (!settings) return DEFAULT_USER_SETTINGS.costBasisMethod;
        const data = settings.settings as Record<string, unknown>;
        return (data.costBasisMethod as CostBasisMethod) ?? DEFAULT_USER_SETTINGS.costBasisMethod;
    }

    private async getQuoteTokenInfo(positionId: string) {
        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: { config: true, user: { select: { reportingCurrency: true } } },
        });
        if (!position) throw new Error(`Position not found: ${positionId}`);

        const config = position.config as Record<string, unknown>;
        const chainId = config.chainId as number;
        const isToken0Quote = config.isToken0Quote as boolean;
        const quoteAddress = isToken0Quote
            ? (config.token0Address as string)
            : (config.token1Address as string);

        const quoteToken = await prisma.token.findUnique({
            where: { tokenHash: createErc20TokenHash(chainId, quoteAddress) },
            select: { decimals: true, coingeckoId: true },
        });
        if (!quoteToken) throw new Error(`Quote token not found for ${quoteAddress} on chain ${chainId}`);

        return {
            reportingCurrency: position.user.reportingCurrency,
            quoteTokenDecimals: quoteToken.decimals,
            quoteCoingeckoId: quoteToken.coingeckoId,
        };
    }

    private async getReportingContext(positionId: string): Promise<ReportingContext> {
        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: {
                protocol: true, config: true,
                user: { select: { reportingCurrency: true } },
            },
        });
        if (!position) throw new Error(`Position not found: ${positionId}`);

        const positionConfig = position.config as Record<string, unknown>;
        const token0Address = positionConfig.token0Address as string;
        const token1Address = positionConfig.token1Address as string;
        const chainId = positionConfig.chainId as number;
        const vaultAddress = positionConfig.vaultAddress as string;

        const [token0Row, token1Row] = await Promise.all([
            prisma.token.findUnique({
                where: { tokenHash: createErc20TokenHash(chainId, token0Address) },
                select: { decimals: true, coingeckoId: true },
            }),
            prisma.token.findUnique({
                where: { tokenHash: createErc20TokenHash(chainId, token1Address) },
                select: { decimals: true, coingeckoId: true },
            }),
        ]);
        if (!token0Row) throw new Error(`Token not found for address ${token0Address} on chain ${chainId}`);
        if (!token1Row) throw new Error(`Token not found for address ${token1Address} on chain ${chainId}`);

        const isToken0Quote = positionConfig.isToken0Quote as boolean;
        const quoteToken = isToken0Quote ? token0Row : token1Row;
        const reportingCurrency = position.user.reportingCurrency;
        const reportingCurrencyUsdPrice = 1.0;

        let quoteTokenUsdPrice = 1.0;
        if (quoteToken.coingeckoId) {
            const prices = await CoinGeckoClient.getInstance().getSimplePrices([quoteToken.coingeckoId]);
            quoteTokenUsdPrice = prices[quoteToken.coingeckoId]?.usd ?? 1.0;
        }

        const rate = quoteTokenUsdPrice / reportingCurrencyUsdPrice;
        const exchangeRate = BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));

        return {
            reportingCurrency,
            exchangeRate: exchangeRate.toString(),
            quoteTokenDecimals: quoteToken.decimals,
            instrumentRef: `uniswapv3-staking/${chainId}/${vaultAddress}`,
        };
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

function absBigint(value: string): string {
    const n = BigInt(value);
    return (n < 0n ? -n : n).toString();
}

function absBigintValue(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function computeReportingAmount(
    amountQuote: string, exchangeRate: string, quoteTokenDecimals: number,
): string {
    const amount = BigInt(amountQuote);
    const rate = BigInt(exchangeRate);
    const scale = 10n ** BigInt(quoteTokenDecimals);
    const absAmount = amount < 0n ? -amount : amount;
    return ((absAmount * rate) / scale).toString();
}

function computeHistoricRate(
    quoteCoingeckoId: string | null,
    priceTimeSeries: [number, number][],
    eventTimestamp: Date,
): bigint {
    let quoteTokenUsdPrice = 1.0;
    if (quoteCoingeckoId && priceTimeSeries.length > 0) {
        quoteTokenUsdPrice = findClosestPrice(priceTimeSeries, eventTimestamp.getTime());
    }
    const reportingCurrencyUsdPrice = 1.0;
    const rate = quoteTokenUsdPrice / reportingCurrencyUsdPrice;
    return BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));
}
