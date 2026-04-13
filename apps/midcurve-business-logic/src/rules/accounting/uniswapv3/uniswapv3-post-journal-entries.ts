/**
 * UniswapV3PostJournalEntriesRule
 *
 * Subscribes to UniswapV3 NFT position domain events,
 * maintains token lots, and creates double-entry journal entries.
 *
 * Flow: Domain Events → Token Lots → Journal Entries (lot-based cost basis)
 *
 * Acquisition events (create lots + DR 1000 / CR 3000):
 * - position.created           → Backfill lots + entries from ledger history
 * - position.liquidity.increased → Create acquisition lot + entry
 * - position.transferred.in    → Create acquisition lot + entry
 *
 * Disposal events (consume lots + CR 1000 / DR 3100 / gain-loss / FX):
 * - position.liquidity.decreased → Dispose lots + entry
 * - position.transferred.out   → Dispose lots + entry
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
  getUniswapV3NfpmAddress,
  ACCOUNT_CODES,
  type JournalLineInput,
  type CostBasisMethod,
  DEFAULT_USER_SETTINGS,
} from '@midcurve/shared';
import { BusinessRule } from '../../base';

// =============================================================================
// Constants
// =============================================================================

const QUEUE_NAME = 'business-logic.uniswapv3-post-journal-entries';
const ROUTING_PATTERN = 'positions.*.uniswapv3';
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

export class UniswapV3PostJournalEntriesRule extends BusinessRule {
  readonly ruleName = 'uniswapv3-post-journal-entries';
  readonly ruleDescription =
    'Maintains token lots and journal entries from UniswapV3 NFT position domain events';

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
      'Subscribed to UniswapV3 NFT position events',
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
        'Processing position event',
      );

      await this.routeEvent(event, eventType);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing position event',
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
   * position.created → Backfill lots + journal entries from ledger history.
   *
   * Uses historic CoinGecko prices for event-time exchange rates.
   */
  private async handlePositionCreated(
    event: DomainEvent<PositionLifecyclePayload>,
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { id: true, userId: true, protocol: true, config: true },
    });
    if (!position) {
      this.logger.warn({ positionId }, 'Position not found for position.created');
      return;
    }

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    // Idempotency — skip if lots already exist
    const existingLots = await this.tokenLotService.getOpenLots(position.userId, tokenCtx.tokenHash);
    if (existingLots.length > 0) {
      this.logger.info({ positionHash }, 'Lots already exist for position, skipping backfill');
      return;
    }

    const costBasisMethod = await this.getUserCostBasisMethod(position.userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const ledgerEvents = await prisma.positionLedgerEvent.findMany({
      where: {
        positionId,
        eventType: { in: ['INCREASE_POSITION', 'DECREASE_POSITION', 'TRANSFER'] },
        isIgnored: false,
      },
      select: {
        id: true, eventType: true, inputHash: true, timestamp: true,
        tokenValue: true, deltaCostBasis: true, deltaPnl: true, config: true,
      },
      orderBy: { timestamp: 'asc' },
    });

    if (ledgerEvents.length === 0) return;

    // Resolve position metadata for reporting context
    const positionConfig = position.config as Record<string, unknown>;
    const chainId = positionConfig.chainId as number;
    const poolAddress = positionConfig.poolAddress as string;
    const positionRef = positionHash;
    const instrumentRef = `${position.protocol}/${chainId}/${poolAddress}`;

    const { reportingCurrency, quoteTokenDecimals, quoteCoingeckoId } =
      await this.getQuoteTokenInfo(positionId);

    // Fetch historic price time series from CoinGecko
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
      const eventRate = computeHistoricRate(quoteCoingeckoId, priceTimeSeries, le.timestamp);
      const eventRateStr = eventRate.toString();

      if (le.eventType === 'TRANSFER') {
        const deltaCostBasis = BigInt(le.deltaCostBasis);
        if (deltaCostBasis === 0n) continue;

        const domainEventId = `${event.id}:${le.inputHash}`;
        if (await this.journalService.isProcessed(domainEventId)) continue;

        if (deltaCostBasis > 0n) {
          // Transfer IN
          const liquidityAfter = config.liquidityAfter as string;
          const costBasisAbsolute = computeReportingAmount(le.deltaCostBasis, eventRateStr, quoteTokenDecimals);

          const lotId = await this.tokenLotService.createLot({
            userId: position.userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
            quantity: liquidityAfter, costBasisAbsolute, acquiredAt: le.timestamp,
            acquisitionEventId: le.inputHash, positionLedgerEventId: le.id, transferEvent: 'TRANSFER_IN',
          });

          await this.createAcquisitionEntry(
            position.userId, domainEventId, 'position.transferred.in',
            le.id,
            le.timestamp, le.deltaCostBasis, lotId, positionRef, instrumentRef,
            reportingCurrency, eventRateStr, quoteTokenDecimals,
          );
        } else {
          // Transfer OUT
          const openLots = await this.tokenLotService.getOpenLots(position.userId, tokenCtx.tokenHash);
          const totalOpen = openLots.reduce((sum, lot) => sum + BigInt(lot.openQuantity), 0n);
          if (totalOpen > 0n) {
            const proceedsReporting = computeReportingAmount(le.tokenValue, eventRateStr, quoteTokenDecimals);
            const result = await this.tokenLotService.disposeLots({
              userId: position.userId, tokenHash: tokenCtx.tokenHash,
              quantityToDispose: totalOpen.toString(), proceedsReporting,
              disposedAt: le.timestamp, disposalEventId: le.inputHash,
              positionLedgerEventId: le.id, transferEvent: 'TRANSFER_OUT', lotSelector,
            });

            await this.createDisposalEntries(
              position.userId, domainEventId, 'position.transferred.out',
              le.id,
              le.timestamp, le, result, positionRef, instrumentRef,
              reportingCurrency, eventRateStr, quoteTokenDecimals,
            );
          }
        }
        continue;
      }

      // INCREASE_POSITION / DECREASE_POSITION
      const deltaL = config.deltaL as string;
      const absDeltaL = absBigint(deltaL);
      if (absDeltaL === '0') continue;

      const domainEventId = `${event.id}:${le.inputHash}`;
      if (await this.journalService.isProcessed(domainEventId)) continue;

      if (le.eventType === 'INCREASE_POSITION') {
        if (le.deltaCostBasis === '0') continue;
        const costBasisAbsolute = computeReportingAmount(le.deltaCostBasis, eventRateStr, quoteTokenDecimals);

        const lotId = await this.tokenLotService.createLot({
          userId: position.userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
          quantity: absDeltaL, costBasisAbsolute, acquiredAt: le.timestamp,
          acquisitionEventId: le.inputHash, positionLedgerEventId: le.id, transferEvent: 'INCREASE_POSITION',
        });

        await this.createAcquisitionEntry(
          position.userId, domainEventId, 'position.liquidity.increased',
          le.id,
          le.timestamp, le.deltaCostBasis, lotId, positionRef, instrumentRef,
          reportingCurrency, eventRateStr, quoteTokenDecimals,
        );
      } else if (le.eventType === 'DECREASE_POSITION') {
        const proceedsReporting = computeReportingAmount(le.tokenValue, eventRateStr, quoteTokenDecimals);
        const result = await this.tokenLotService.disposeLots({
          userId: position.userId, tokenHash: tokenCtx.tokenHash,
          quantityToDispose: absDeltaL, proceedsReporting,
          disposedAt: le.timestamp, disposalEventId: le.inputHash,
          positionLedgerEventId: le.id, transferEvent: 'DECREASE_POSITION', lotSelector,
        });

        await this.createDisposalEntries(
          position.userId, domainEventId, 'position.liquidity.decreased',
          le.id,
          le.timestamp, le, result, positionRef, instrumentRef,
          reportingCurrency, eventRateStr, quoteTokenDecimals,
        );
      }
    }

    this.logger.info(
      { positionHash, eventsProcessed: ledgerEvents.length },
      'Token lots and journal entries backfilled from ledger history',
    );
  }

  /**
   * position.liquidity.increased → Create acquisition lot + DR 1000 / CR 3000.
   */
  private async handleLiquidityIncreased(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for liquidity increase');
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
      userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
      quantity: deltaL, costBasisAbsolute,
      acquiredAt: new Date(event.payload.eventTimestamp),
      acquisitionEventId: ledgerInputHash, positionLedgerEventId: ledgerEvent.id,
      transferEvent: 'INCREASE_POSITION',
    });

    await this.createAcquisitionEntry(
      userId, event.id, event.type,
      ledgerEvent.id,
      new Date(event.payload.eventTimestamp), deltaCostBasis,
      lotId, positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  /**
   * position.transferred.in → Create acquisition lot + DR 1000 / CR 3000.
   */
  private async handleTransferredIn(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for transfer in');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const liquidityAfter = config.liquidityAfter as string;
    const costBasis = ledgerEvent.deltaCostBasis;
    if (!liquidityAfter || liquidityAfter === '0' || costBasis === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisAbsolute = computeReportingAmount(
      costBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    const lotId = await this.tokenLotService.createLot({
      userId, tokenId: tokenCtx.tokenId, tokenHash: tokenCtx.tokenHash,
      quantity: liquidityAfter, costBasisAbsolute,
      acquiredAt: new Date(event.payload.eventTimestamp),
      acquisitionEventId: ledgerInputHash, positionLedgerEventId: ledgerEvent.id,
      transferEvent: 'TRANSFER_IN',
    });

    await this.createAcquisitionEntry(
      userId, event.id, event.type,
      ledgerEvent.id,
      new Date(event.payload.eventTimestamp), costBasis,
      lotId, positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  // ===========================================================================
  // Disposal Handlers — consume lots + journal entries
  // ===========================================================================

  /**
   * position.liquidity.decreased → Dispose lots + CR 1000 / DR 3100 / gain-loss / FX.
   */
  private async handleLiquidityDecreased(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId }, 'No ledger event found for liquidity decrease');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const deltaL = config.deltaL as string;
    if (!deltaL || deltaL === '0') return;

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
      quantityToDispose: absBigint(deltaL), proceedsReporting,
      disposedAt: new Date(event.payload.eventTimestamp),
      disposalEventId: ledgerInputHash, positionLedgerEventId: ledgerEvent.id,
      transferEvent: 'DECREASE_POSITION', lotSelector,
    });

    await this.createDisposalEntries(
      userId, event.id, event.type,
      ledgerEvent.id,
      new Date(event.payload.eventTimestamp), ledgerEvent, result,
      positionHash, ctx.poolHash,
      ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );
  }

  /**
   * position.transferred.out → Dispose all remaining lots + journal entries.
   */
  private async handleTransferredOut(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for transfer out');
      return;
    }

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const openLots = await this.tokenLotService.getOpenLots(userId, tokenCtx.tokenHash);
    const totalOpenQuantity = openLots.reduce(
      (sum, lot) => sum + BigInt(lot.openQuantity), 0n,
    );
    if (totalOpenQuantity <= 0n) return;

    const ctx = await this.getReportingContext(positionId);
    const costBasisMethod = await this.getUserCostBasisMethod(userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const proceedsReporting = computeReportingAmount(
      ledgerEvent.tokenValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    const result = await this.tokenLotService.disposeLots({
      userId, tokenHash: tokenCtx.tokenHash,
      quantityToDispose: totalOpenQuantity.toString(), proceedsReporting,
      disposedAt: new Date(event.payload.eventTimestamp),
      disposalEventId: ledgerInputHash, positionLedgerEventId: ledgerEvent.id,
      transferEvent: 'TRANSFER_OUT', lotSelector,
    });

    await this.createDisposalEntries(
      userId, event.id, event.type,
      ledgerEvent.id,
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
        positionLedgerEventId: ledgerEvent ? ledgerEvent.id : undefined,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Fees collected: ${positionHash}`,
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
        description: `Cost basis correction: ${positionRef}`,
      },
      lines,
    );
  }

  /**
   * position.deleted → No-op.
   * All cleanup handled by FK cascade: Position → PositionLedgerEvent →
   * TokenLot/TokenLotDisposal/JournalEntry (all cascade-deleted).
   */
  private async handlePositionDeleted(
    event: DomainEvent<PositionLifecyclePayload>,
  ): Promise<void> {
    this.logger.info(
      { positionHash: event.payload.positionHash },
      'Position deleted — lots, disposals, and journal entries cascade-deleted via FK',
    );
  }

  /**
   * position.liquidity.reverted → No-op.
   * Reverted ledger events are already deleted before this event fires.
   * FK cascade (PositionLedgerEvent → TokenLot/TokenLotDisposal/JournalEntry)
   * handles all cleanup automatically.
   */
  private async handleLiquidityReverted(
    event: DomainEvent<PositionLiquidityRevertedPayload>,
  ): Promise<void> {
    this.logger.info(
      { positionHash: event.payload.positionHash, blockHash: event.payload.blockHash },
      'Liquidity reverted — lots, disposals, and journal entries cascade-deleted via FK',
    );
  }

  // ===========================================================================
  // Journal Entry Builders
  // ===========================================================================

  /**
   * Create a balanced acquisition journal entry: DR 1000 / CR 3000.
   * Linked to the TokenLot via tokenLotId FK (cascade-deletes on lot removal).
   */
  private async createAcquisitionEntry(
    userId: string,
    domainEventId: string,
    domainEventType: string,
    positionLedgerEventId: string,
    entryDate: Date,
    deltaCostBasis: string,
    tokenLotId: string,
    positionRef: string,
    instrumentRef: string,
    reportingCurrency: string,
    exchangeRate: string,
    quoteTokenDecimals: number,
  ): Promise<void> {
    const lines = new JournalLineBuilder()
      .withReporting(reportingCurrency, exchangeRate, quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, deltaCostBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, deltaCostBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      { userId, domainEventId, domainEventType, positionLedgerEventId, entryDate,
        tokenLotId, description: `Acquisition: ${positionRef}` },
      lines,
    );
  }

  /**
   * Create one balanced journal entry per disposal (per consumed lot).
   * Each entry: CR 1000 + DR 3100 + DR/CR gain/loss + CR/DR FX.
   * Linked to the TokenLotDisposal via tokenLotDisposalId FK (cascade-deletes on disposal removal).
   *
   * Quote-token amounts are distributed proportionally across disposals.
   */
  private async createDisposalEntries(
    userId: string,
    domainEventId: string,
    domainEventType: string,
    positionLedgerEventId: string,
    entryDate: Date,
    ledgerEvent: { deltaCostBasis: string; tokenValue: string; deltaPnl: string },
    result: DisposalResult,
    positionRef: string,
    instrumentRef: string,
    reportingCurrency: string,
    exchangeRate: string,
    quoteTokenDecimals: number,
  ): Promise<void> {
    const totalQtyDisposed = result.totalQuantityDisposed;
    const absDeltaCostBasis = BigInt(absBigint(ledgerEvent.deltaCostBasis));
    const totalTokenValue = BigInt(ledgerEvent.tokenValue);
    const totalDeltaPnl = BigInt(ledgerEvent.deltaPnl);
    const decimalsScale = 10n ** BigInt(quoteTokenDecimals);
    const spotRate = BigInt(exchangeRate);

    let costBasisDistributed = 0n;
    let tokenValueDistributed = 0n;
    let deltaPnlDistributed = 0n;

    for (let i = 0; i < result.disposals.length; i++) {
      const d = result.disposals[i]!;
      const isLast = i === result.disposals.length - 1;
      const qty = BigInt(d.quantityDisposed);

      // Proportional quote-token amounts (last gets remainder to avoid rounding dust)
      const proportionalCostBasis = isLast
        ? absDeltaCostBasis - costBasisDistributed
        : (qty * absDeltaCostBasis) / totalQtyDisposed;
      const proportionalTokenValue = isLast
        ? totalTokenValue - tokenValueDistributed
        : (qty * totalTokenValue) / totalQtyDisposed;
      const proportionalPnl = isLast
        ? totalDeltaPnl - deltaPnlDistributed
        : (qty * totalDeltaPnl) / totalQtyDisposed;

      costBasisDistributed += proportionalCostBasis;
      tokenValueDistributed += proportionalTokenValue;
      deltaPnlDistributed += proportionalPnl;

      const builder = new JournalLineBuilder()
        .withReporting(reportingCurrency, exchangeRate, quoteTokenDecimals);

      builder.credit(ACCOUNT_CODES.LP_POSITION_AT_COST, proportionalCostBasis.toString(), positionRef, instrumentRef);
      builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, proportionalTokenValue.toString(), positionRef, instrumentRef);

      if (proportionalPnl > 0n) {
        builder.credit(ACCOUNT_CODES.REALIZED_GAINS, proportionalPnl.toString(), positionRef, instrumentRef);
      } else if (proportionalPnl < 0n) {
        builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, (-proportionalPnl).toString(), positionRef, instrumentRef);
      }

      const lines = builder.build();

      // Override cost basis reporting with lot-derived value
      const cbLine = lines.find((l) => l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST)!;
      const cbAtSpot = (proportionalCostBasis * spotRate) / decimalsScale;
      const lotCostBasis = BigInt(d.costBasisAllocated);
      cbLine.amountReporting = lotCostBasis.toString();

      // FX difference
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

      await this.journalService.createEntry(
        { userId, domainEventId: `${domainEventId}:${d.id}`, domainEventType, positionLedgerEventId, entryDate,
          tokenLotDisposalId: d.id, description: `Disposal: ${positionRef}` },
        lines,
      );
    }
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
    const nftId = config.nftId as number;
    const nfpmAddress = getUniswapV3NfpmAddress(chainId);
    const tokenHash = createErc721TokenHash(chainId, nfpmAddress, nftId.toString());

    const token = await prisma.token.upsert({
      where: { tokenHash },
      update: {},
      create: {
        tokenType: 'erc721',
        name: `UniswapV3 Position (${nftId})`,
        symbol: 'UV3-NFT',
        decimals: 0,
        tokenHash,
        config: { chainId, protocol: 'uniswapv3' },
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

  /**
   * Get quote token metadata for historic price lookups (used by backfill).
   */
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

  /**
   * Resolve reporting currency context for a position (current spot price).
   * Used by live event handlers where events are processed in near-real-time.
   */
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
      poolHash: `${position.protocol}/${chainId}/${poolAddress}`,
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

/**
 * Convert a quote-token amount to reporting currency.
 * result = abs(amountQuote) * exchangeRate / 10^quoteTokenDecimals
 */
function computeReportingAmount(
  amountQuote: string,
  exchangeRate: string,
  quoteTokenDecimals: number,
): string {
  const amount = BigInt(amountQuote);
  const rate = BigInt(exchangeRate);
  const scale = 10n ** BigInt(quoteTokenDecimals);
  const absAmount = amount < 0n ? -amount : amount;
  return ((absAmount * rate) / scale).toString();
}

/**
 * Compute exchange rate at a specific event timestamp using historic CoinGecko data.
 */
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
