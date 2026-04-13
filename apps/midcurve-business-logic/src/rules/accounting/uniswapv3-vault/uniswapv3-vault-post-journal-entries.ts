/**
 * UniswapV3VaultPostJournalEntriesRule
 *
 * Subscribes to UniswapV3-Vault position domain events,
 * maintains token lots, and creates double-entry journal entries.
 *
 * Vault positions represent shares in a vault that wraps a UniswapV3 NFT.
 * Lot quantity is denominated in vault shares (not liquidity units).
 *
 * Flow: Domain Events → Token Lots → Journal Entries (lot-based cost basis)
 *
 * Acquisition events (create lots + DR 1000 / CR 3000):
 * - position.created           → Backfill lots + entries from ledger history
 * - position.liquidity.increased → VAULT_MINT lot + entry
 * - position.transferred.in    → VAULT_TRANSFER_IN lot + entry
 *
 * Disposal events (consume lots + CR 1000 / DR 3100 / gain-loss / FX):
 * - position.liquidity.decreased → VAULT_BURN disposal + entry
 * - position.transferred.out   → VAULT_TRANSFER_OUT disposal + entry
 *
 * Non-lot events:
 * - position.fees.collected    → DR 3100 / CR 4000 (outside lot system)
 * - position.closed            → Cost basis correction (zero remainder → FX)
 * - position.burned            → No financial entry
 * - position.deleted           → Delete all lots + journal entries
 * - position.liquidity.reverted → Delete lots + entries for reverted events
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
  createErc721TokenHash,
  ACCOUNT_CODES,
  LEDGER_REF_PREFIX,
  type JournalLineInput,
  type CostBasisMethod,
  DEFAULT_USER_SETTINGS,
} from '@midcurve/shared';
import { BusinessRule } from '../../base';

// =============================================================================
// Constants
// =============================================================================

const QUEUE_NAME = 'business-logic.uniswapv3-vault-post-journal-entries';
const ROUTING_PATTERN = 'positions.*.uniswapv3-vault';
const FLOAT_TO_BIGINT_SCALE = 1e8;

// =============================================================================
// Types
// =============================================================================

interface ReportingContext {
  reportingCurrency: string;
  exchangeRate: string;
  quoteTokenDecimals: number;
  poolHash: string;
}

interface PositionTokenContext {
  tokenId: string;
  tokenHash: string;
}

// =============================================================================
// Rule Implementation
// =============================================================================

export class UniswapV3VaultPostJournalEntriesRule extends BusinessRule {
  readonly ruleName = 'uniswapv3-vault-post-journal-entries';
  readonly ruleDescription =
    'Maintains token lots and journal entries from UniswapV3 Vault position domain events';

  private consumerTag: string | null = null;
  private readonly tokenLotService: TokenLotService;
  private readonly journalService: JournalService;

  constructor() {
    super();
    this.tokenLotService = TokenLotService.getInstance();
    this.journalService = JournalService.getInstance();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

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
      'Subscribed to UniswapV3 Vault position events',
    );
  }

  protected async onShutdown(): Promise<void> {
    if (this.consumerTag && this.channel) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
  }

  // ===========================================================================
  // Message Routing
  // ===========================================================================

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    try {
      const event = JSON.parse(msg.content.toString()) as DomainEvent;
      const eventType = event.type as PositionEventType;

      this.logger.info(
        { eventId: event.id, eventType, entityId: event.entityId },
        'Processing vault position event',
      );

      await this.routeEvent(event, eventType);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing vault position event',
      );
      this.channel.nack(msg, false, false);
    }
  }

  private async routeEvent(
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
      case 'position.fees.collected':
        return this.handleFeesCollected(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.transferred.in':
        return this.handleTransferredIn(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.transferred.out':
        return this.handleTransferredOut(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.closed':
        return this.handlePositionClosed(event as DomainEvent<PositionLifecyclePayload>);
      case 'position.burned':
        return;
      case 'position.deleted':
        return this.handlePositionDeleted(event as DomainEvent<PositionLifecyclePayload>);
      case 'position.liquidity.reverted':
        return this.handleLiquidityReverted(event as DomainEvent<PositionLiquidityRevertedPayload>);
      default:
        this.logger.warn({ eventType }, 'Unknown position event type, skipping');
    }
  }

  // ===========================================================================
  // Acquisition Handlers — create lots + journal entries
  // ===========================================================================

  /**
   * position.created → Backfill lots + journal entries from vault ledger history.
   *
   * Uses historic CoinGecko prices for event-time exchange rates.
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

    // Vault ownership guard
    const positionState = position.state as Record<string, unknown>;
    if (positionState.isOwnedByUser === false) {
      this.logger.info({ positionHash }, 'Skipping backfill — vault position not owned by user');
      return;
    }

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    // Idempotency
    const existingLots = await this.tokenLotService.getOpenLots(position.userId, tokenCtx.tokenHash);
    if (existingLots.length > 0) {
      this.logger.info({ positionHash }, 'Lots already exist for vault position, skipping backfill');
      return;
    }

    const costBasisMethod = await this.getUserCostBasisMethod(position.userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const ledgerEvents = await prisma.positionLedgerEvent.findMany({
      where: {
        positionId,
        eventType: { in: ['VAULT_MINT', 'VAULT_BURN', 'VAULT_TRANSFER_IN', 'VAULT_TRANSFER_OUT'] },
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
    const poolAddress = positionConfig.poolAddress as string;
    const positionRef = positionHash;
    const instrumentRef = `uniswapv3-vault/${chainId}/${poolAddress}`;

    const { reportingCurrency, quoteTokenDecimals, quoteCoingeckoId } =
      await this.getQuoteTokenInfo(positionId);

    // Fetch historic price time series
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
      const shares = config.shares as string;
      if (!shares || shares === '0') continue;

      const eventRate = computeHistoricRate(quoteCoingeckoId, priceTimeSeries, le.timestamp);
      const eventRateStr = eventRate.toString();

      const domainEventId = `${event.id}:${le.inputHash}`;
      if (await this.journalService.isProcessed(domainEventId)) continue;

      if (le.eventType === 'VAULT_MINT' || le.eventType === 'VAULT_TRANSFER_IN') {
        if (le.deltaCostBasis === '0') continue;
        const costBasisAbsolute = computeReportingAmount(le.deltaCostBasis, eventRateStr, quoteTokenDecimals);

        await this.tokenLotService.createLot({
          userId: position.userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
          quantity: shares, costBasisAbsolute, acquiredAt: le.timestamp,
          acquisitionEventId: le.inputHash,
          transferEvent: le.eventType === 'VAULT_TRANSFER_IN' ? 'TRANSFER_IN' : 'VAULT_MINT',
        });

        await this.createAcquisitionEntry(
          position.userId, domainEventId,
          le.eventType === 'VAULT_TRANSFER_IN' ? 'position.transferred.in' : 'position.liquidity.increased',
          `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${le.id}`,
          le.timestamp, le.deltaCostBasis, positionRef, instrumentRef,
          reportingCurrency, eventRateStr, quoteTokenDecimals,
        );
      } else if (le.eventType === 'VAULT_BURN' || le.eventType === 'VAULT_TRANSFER_OUT') {
        const proceedsReporting = computeReportingAmount(le.tokenValue, eventRateStr, quoteTokenDecimals);
        const result = await this.tokenLotService.disposeLots({
          userId: position.userId, tokenHash: tokenCtx.tokenHash,
          quantityToDispose: shares, proceedsReporting,
          disposedAt: le.timestamp, disposalEventId: le.inputHash,
          transferEvent: le.eventType === 'VAULT_TRANSFER_OUT' ? 'TRANSFER_OUT' : 'VAULT_BURN',
          lotSelector,
        });

        await this.createDisposalEntry(
          position.userId, domainEventId,
          le.eventType === 'VAULT_TRANSFER_OUT' ? 'position.transferred.out' : 'position.liquidity.decreased',
          `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${le.id}`,
          le.timestamp, le, result, positionRef, instrumentRef,
          reportingCurrency, eventRateStr, quoteTokenDecimals,
        );
      }
    }

    this.logger.info(
      { positionHash, eventsProcessed: ledgerEvents.length },
      'Token lots and journal entries backfilled from vault ledger history',
    );
  }

  /**
   * position.liquidity.increased → VAULT_MINT lot + DR 1000 / CR 3000.
   */
  private async handleLiquidityIncreased(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for vault mint');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    if (!shares || shares === '0') return;

    const deltaCostBasis = ledgerEvent.deltaCostBasis;
    if (deltaCostBasis === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisAbsolute = computeReportingAmount(
      deltaCostBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    await this.tokenLotService.createLot({
      userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
      quantity: shares, costBasisAbsolute,
      acquiredAt: new Date(event.payload.eventTimestamp),
      acquisitionEventId: ledgerInputHash, transferEvent: 'VAULT_MINT',
    });

    await this.createAcquisitionEntry(
      userId, event.id, event.type,
      `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}`,
      new Date(event.payload.eventTimestamp), deltaCostBasis,
      positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  /**
   * position.transferred.in → VAULT_TRANSFER_IN lot + DR 1000 / CR 3000.
   */
  private async handleTransferredIn(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for vault transfer in');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    const costBasis = ledgerEvent.deltaCostBasis;
    if (!shares || shares === '0' || costBasis === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisAbsolute = computeReportingAmount(
      costBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    await this.tokenLotService.createLot({
      userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
      quantity: shares, costBasisAbsolute,
      acquiredAt: new Date(event.payload.eventTimestamp),
      acquisitionEventId: ledgerInputHash, transferEvent: 'TRANSFER_IN',
    });

    await this.createAcquisitionEntry(
      userId, event.id, event.type,
      `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}`,
      new Date(event.payload.eventTimestamp), costBasis,
      positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  // ===========================================================================
  // Disposal Handlers — consume lots + journal entries
  // ===========================================================================

  /**
   * position.liquidity.decreased → VAULT_BURN disposal + journal entry.
   */
  private async handleLiquidityDecreased(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId }, 'No ledger event found for vault burn');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    if (!shares || shares === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisMethod = await this.getUserCostBasisMethod(userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const proceedsReporting = computeReportingAmount(
      ledgerEvent.tokenValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    const result = await this.tokenLotService.disposeLots({
      userId, tokenHash: tokenCtx.tokenHash,
      quantityToDispose: shares, proceedsReporting,
      disposedAt: new Date(event.payload.eventTimestamp),
      disposalEventId: ledgerInputHash, transferEvent: 'VAULT_BURN', lotSelector,
    });

    await this.createDisposalEntry(
      userId, event.id, event.type,
      `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}`,
      new Date(event.payload.eventTimestamp), ledgerEvent, result,
      positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  /**
   * position.transferred.out → Dispose transferred shares + journal entry.
   */
  private async handleTransferredOut(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for vault transfer out');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    if (!shares || shares === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisMethod = await this.getUserCostBasisMethod(userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const proceedsReporting = computeReportingAmount(
      ledgerEvent.tokenValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    const result = await this.tokenLotService.disposeLots({
      userId, tokenHash: tokenCtx.tokenHash,
      quantityToDispose: shares, proceedsReporting,
      disposedAt: new Date(event.payload.eventTimestamp),
      disposalEventId: ledgerInputHash, transferEvent: 'TRANSFER_OUT', lotSelector,
    });

    await this.createDisposalEntry(
      userId, event.id, event.type,
      `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}`,
      new Date(event.payload.eventTimestamp), ledgerEvent, result,
      positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  // ===========================================================================
  // Non-Lot Handlers
  // ===========================================================================

  /**
   * position.fees.collected → DR 3100 / CR 4000.
   */
  private async handleFeesCollected(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    const totalFees = ledgerEvent ? BigInt(ledgerEvent.deltaCollectedYield) : 0n;
    if (totalFees <= 0n) return;

    const ctx = await this.getReportingContext(positionId);
    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalFees.toString(), positionHash, ctx.poolHash)
      .credit(ACCOUNT_CODES.FEE_INCOME, totalFees.toString(), positionHash, ctx.poolHash)
      .build();

    await this.journalService.createEntry(
      {
        userId,
        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: ledgerEvent ? `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}` : undefined,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Vault fees collected: ${positionHash}`,
      },
      lines,
    );
  }

  /**
   * position.closed → Zero out cost basis remainder against FX_GAIN_LOSS.
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
          { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'debit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
            exchangeRate: ctx.exchangeRate, positionRef, instrumentRef: ctx.poolHash },
          { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'credit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
            exchangeRate: ctx.exchangeRate, positionRef, instrumentRef: ctx.poolHash },
        ]
      : [
          { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'credit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
            exchangeRate: ctx.exchangeRate, positionRef, instrumentRef: ctx.poolHash },
          { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'debit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
            exchangeRate: ctx.exchangeRate, positionRef, instrumentRef: ctx.poolHash },
        ];

    await this.journalService.createEntry(
      {
        userId,
        domainEventId: correctionEventId,
        domainEventType: event.type,
        entryDate: new Date(event.timestamp),
        description: `Vault cost basis correction: ${positionRef}`,
      },
      lines,
    );
  }

  /**
   * position.deleted → Delete all lots + journal entries.
   */
  private async handlePositionDeleted(
    event: DomainEvent<PositionLifecyclePayload>,
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true },
    });
    if (!position) return;

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const lotCount = await this.tokenLotService.deleteLotsByTokenHash(
      position.userId, tokenCtx.tokenHash,
    );
    const entryCount = await this.journalService.deleteEntriesByPositionRef(positionHash);

    this.logger.info(
      { positionHash, deletedLots: lotCount, deletedEntries: entryCount },
      'Deleted lots and journal entries for deleted vault position',
    );
  }

  /**
   * position.liquidity.reverted → Delete lots + journal entries for reverted events.
   */
  private async handleLiquidityReverted(
    event: DomainEvent<PositionLiquidityRevertedPayload>,
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true },
    });
    if (!position) return;

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    // Delete orphaned lots
    const existingEvents = await prisma.positionLedgerEvent.findMany({
      where: { positionId },
      select: { inputHash: true },
    });
    const existingHashes = new Set(existingEvents.map((e) => e.inputHash));

    const allLots = await prisma.tokenLot.findMany({
      where: { userId: position.userId, tokenHash: tokenCtx.tokenHash },
      select: { acquisitionEventId: true },
    });
    const orphanedEventIds = allLots
      .filter((lot) => !existingHashes.has(lot.acquisitionEventId))
      .map((lot) => lot.acquisitionEventId);

    if (orphanedEventIds.length > 0) {
      const lotCount = await this.tokenLotService.deleteLotsByAcquisitionEventIds(
        position.userId, tokenCtx.tokenHash, orphanedEventIds,
      );
      this.logger.info({ positionHash, deletedLots: lotCount }, 'Deleted reverted vault lots');
    }

    // Delete orphaned journal entries
    const prefix = `${LEDGER_REF_PREFIX.POSITION_LEDGER}:`;
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        ledgerEventRef: { startsWith: prefix },
        lines: { some: { positionRef: positionHash } },
      },
      select: { id: true, ledgerEventRef: true },
    });

    if (journalEntries.length > 0) {
      const refToId = new Map(
        journalEntries.map((e) => [e.ledgerEventRef!, e.ledgerEventRef!.slice(prefix.length)]),
      );
      const existingLedgerIds = new Set(
        (await prisma.positionLedgerEvent.findMany({
          where: { positionId, id: { in: [...refToId.values()] } },
          select: { id: true },
        })).map((e) => e.id),
      );

      const orphanedRefs = journalEntries
        .filter((e) => e.ledgerEventRef && !existingLedgerIds.has(refToId.get(e.ledgerEventRef!)!))
        .map((e) => e.ledgerEventRef!);

      if (orphanedRefs.length > 0) {
        const entryCount = await this.journalService.deleteByLedgerEventRefs(orphanedRefs);
        this.logger.info({ positionHash, deletedEntries: entryCount }, 'Deleted reverted vault journal entries');
      }
    }
  }

  // ===========================================================================
  // Journal Entry Builders
  // ===========================================================================

  private async createAcquisitionEntry(
    userId: string, domainEventId: string, domainEventType: string,
    ledgerEventRef: string, entryDate: Date, deltaCostBasis: string,
    positionRef: string, instrumentRef: string,
    reportingCurrency: string, exchangeRate: string, quoteTokenDecimals: number,
  ): Promise<void> {
    const lines = new JournalLineBuilder()
      .withReporting(reportingCurrency, exchangeRate, quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, deltaCostBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, deltaCostBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      { userId, domainEventId, domainEventType, ledgerEventRef, entryDate,
        description: `Vault acquisition: ${positionRef}` },
      lines,
    );
  }

  private async createDisposalEntry(
    userId: string, domainEventId: string, domainEventType: string,
    ledgerEventRef: string, entryDate: Date,
    ledgerEvent: { deltaCostBasis: string; tokenValue: string; deltaPnl: string },
    result: DisposalResult,
    positionRef: string, instrumentRef: string,
    reportingCurrency: string, exchangeRate: string, quoteTokenDecimals: number,
  ): Promise<void> {
    const absDeltaCostBasis = absBigint(ledgerEvent.deltaCostBasis);
    const tokenValue = ledgerEvent.tokenValue;
    const deltaPnl = BigInt(ledgerEvent.deltaPnl);

    const builder = new JournalLineBuilder()
      .withReporting(reportingCurrency, exchangeRate, quoteTokenDecimals);

    builder.credit(ACCOUNT_CODES.LP_POSITION_AT_COST, absDeltaCostBasis, positionRef, instrumentRef);
    builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, tokenValue, positionRef, instrumentRef);

    if (deltaPnl > 0n) {
      builder.credit(ACCOUNT_CODES.REALIZED_GAINS, deltaPnl.toString(), positionRef, instrumentRef);
    } else if (deltaPnl < 0n) {
      builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, (-deltaPnl).toString(), positionRef, instrumentRef);
    }

    const lines = builder.build();

    // Override cost basis reporting with lot-derived value
    const cbLine = lines.find((l) => l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST)!;
    const cbAtSpot = BigInt(cbLine.amountReporting!);
    cbLine.amountReporting = result.totalCostBasisAllocated.toString();

    // FX difference
    const fxDiff = cbAtSpot - result.totalCostBasisAllocated;
    if (fxDiff !== 0n) {
      const fxLine: JournalLineInput = {
        accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
        side: fxDiff > 0n ? 'credit' : 'debit',
        amountQuote: '0',
        amountReporting: (fxDiff < 0n ? -fxDiff : fxDiff).toString(),
        reportingCurrency,
        exchangeRate,
        positionRef,
        instrumentRef,
      };
      lines.push(fxLine);
    }

    await this.journalService.createEntry(
      { userId, domainEventId, domainEventType, ledgerEventRef, entryDate,
        description: `Vault disposal: ${positionRef}` },
      lines,
    );
  }

  // ===========================================================================
  // Token Resolution
  // ===========================================================================

  private async resolvePositionToken(positionId: string): Promise<PositionTokenContext | null> {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { config: true },
    });
    if (!position) return null;

    const config = position.config as Record<string, unknown>;
    const chainId = config.chainId as number;
    const vaultAddress = config.vaultAddress as string;
    const tokenHash = createErc721TokenHash(chainId, vaultAddress, vaultAddress);

    const token = await prisma.token.upsert({
      where: { tokenHash },
      update: {},
      create: {
        tokenType: 'erc721',
        name: `UniswapV3 Vault (${vaultAddress.slice(0, 8)}...)`,
        symbol: 'UV3-VAULT',
        decimals: 0,
        tokenHash,
        config: { chainId, protocol: 'uniswapv3-vault' },
      },
      select: { id: true, tokenHash: true },
    });

    return { tokenId: token.id, tokenHash: token.tokenHash };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

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
      ? config.token0Address as string
      : config.token1Address as string;

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
    const poolAddress = positionConfig.poolAddress as string;

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
      poolHash: `uniswapv3-vault/${chainId}/${poolAddress}`,
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
