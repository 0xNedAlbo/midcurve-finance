/**
 * PostJournalEntriesOnPositionEventsRule
 *
 * Subscribes to all position domain events and creates balanced double-entry
 * journal entries in the accounting schema. Only realized entries are created.
 *
 * Events handled:
 * - position.created           → DR 1000 / CR 3000 (capital contribution)
 * - position.liquidity.increased → DR 1000 / CR 3000 (additional capital)
 * - position.liquidity.decreased → CR 1000 / DR 3100 + realized gain/loss
 * - position.fees.collected    → DR 3100 / CR 4000 (fee income)
 * - position.closed            → Zero out cost basis remainder
 * - position.burned            → No financial entry (gas deferred to Phase 2)
 * - position.deleted           → Delete all journal entries for position
 * - position.liquidity.reverted → Delete journal entries for reverted ledger events
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  setupConsumerQueue,
  ROUTING_PATTERNS,
  ACCOUNT_CODES,
  LEDGER_REF_PREFIX,
  JournalService,
  JournalBackfillService,
  JournalLineBuilder,
  CoinGeckoClient,
  type DomainEvent,
  type PositionEventType,
  type PositionLifecyclePayload,
  type PositionLedgerEventPayload,
  type PositionLiquidityRevertedPayload,
} from '@midcurve/services';
import { createErc20TokenHash, type JournalLineInput } from '@midcurve/shared';
import { BusinessRule } from '../base';

// =============================================================================
// Constants
// =============================================================================

const QUEUE_NAME = 'business-logic.post-journal-entries';
const ROUTING_PATTERN = ROUTING_PATTERNS.ALL_POSITION_EVENTS;
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

// =============================================================================
// Rule Implementation
// =============================================================================

export class PostJournalEntriesOnPositionEventsRule extends BusinessRule {
  readonly ruleName = 'post-journal-entries-on-position-events';
  readonly ruleDescription =
    'Creates double-entry journal entries from position domain events';

  private consumerTag: string | null = null;
  private readonly journalService: JournalService;
  private readonly backfillService: JournalBackfillService;

  constructor() {
    super();
    this.journalService = JournalService.getInstance();
    this.backfillService = JournalBackfillService.getInstance();
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
      { noAck: false }
    );

    this.consumerTag = result.consumerTag;
    this.logger.info({ queueName: QUEUE_NAME, routingPattern: ROUTING_PATTERN },
      'Subscribed to all position events for journal entries'
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
        'Processing position event for journal'
      );

      await this.routeEvent(event, eventType);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing position event for journal'
      );
      this.channel.nack(msg, false, false);
    }
  }

  private async routeEvent(
    event: DomainEvent,
    eventType: PositionEventType
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
        // No financial entry — gas tracking deferred to Phase 2
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
  // Event Handlers
  // ===========================================================================

  /**
   * position.created → Backfill journal entries from ledger event history
   *
   * Uses JournalBackfillService to replay all ledger events chronologically,
   * creating journal entries with historic exchange rates. This correctly handles
   * positions imported after ownership changes (e.g., NFT tokenized into a vault)
   * by respecting per-event ownership flags (isIgnored) set during ledger import.
   *
   * Falls back to a simple foundation entry if no ledger events exist yet.
   */
  private async handlePositionCreated(
    event: DomainEvent<PositionLifecyclePayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash } = event.payload;
    const positionRef = positionHash;

    // Look up position from DB for protocol-specific config
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { id: true, userId: true, protocol: true, config: true, costBasis: true },
    });
    if (!position) {
      this.logger.warn({ positionId }, 'Position not found for position.created');
      return;
    }

    // Build instrumentRef for backfill
    const positionConfig = position.config as Record<string, unknown>;
    const poolAddress = positionConfig.poolAddress as string;
    const chainId = positionConfig.chainId as number;
    const instrumentRef = `${position.protocol}/${chainId}/${poolAddress}`;

    // Backfill from ledger history (idempotent — skips if entries exist).
    const backfillResult = await this.backfillService.backfillPosition(
      position.id,
      position.userId,
      positionRef,
      instrumentRef,
    );

    if (backfillResult.entriesCreated > 0) {
      this.logger.info(
        { positionRef, entriesCreated: backfillResult.entriesCreated },
        'Journal entries created via backfill on position.created',
      );
      return;
    }

    // Backfill found no financial events — try simple foundation entry
    // (covers edge case where ledger events aren't imported yet)
    const costBasis = position.costBasis;
    if (!costBasis || costBasis === '0') return;

    const ctx = await this.getReportingContext(position.id);
    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId: position.userId,
        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.timestamp),
        description: `Position created: ${positionRef}`,
      },
      lines,
    );
  }

  /**
   * position.liquidity.increased → DR 1000 / CR 3000
   *
   * Records additional capital contribution at the delta cost basis.
   * If the foundation entry was not created by handlePositionCreated (costBasis was 0),
   * creates it here from the position's current costBasis.
   */
  private async handleLiquidityIncreased(
    event: DomainEvent<PositionLedgerEventPayload>
  ): Promise<void> {
    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;

    // If no journal entries exist yet, the foundation entry was missed
    // (costBasis was 0 at position.created time). Create it now.
    const foundationEventId = `${event.id}:foundation`;
    if (!(await this.journalService.hasEntriesForPosition(positionRef))) {
      if (!(await this.journalService.isProcessed(foundationEventId))) {
        const position = await prisma.position.findUnique({
          where: { id: positionId },
          select: { costBasis: true },
        });

        const costBasis = position?.costBasis ?? '0';
        if (costBasis !== '0') {
          const lines = new JournalLineBuilder()
            .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
            .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, positionRef, instrumentRef)
            .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, positionRef, instrumentRef)
            .build();

          await this.journalService.createEntry(
            {
              userId,
              domainEventId: foundationEventId,
              domainEventType: 'position.created',
              entryDate: new Date(event.payload.eventTimestamp),
              description: `Position created (deferred): ${positionRef}`,
            },
            lines
          );
        }
      }
      // Foundation was just created or costBasis is still 0 — skip the delta entry
      // because the foundation already includes the full cost basis at this point
      return;
    }

    if (await this.journalService.isProcessed(event.id)) return;

    // Look up the corresponding ledger event by composite ID
    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash, eventId: event.id }, 'No ledger event found for liquidity increase');
      return;
    }

    const deltaCostBasis = ledgerEvent.deltaCostBasis;
    if (deltaCostBasis === '0') return;

    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, deltaCostBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, deltaCostBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,
        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}`,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Liquidity increase: ${positionRef}`,
      },
      lines
    );
  }

  /**
   * position.liquidity.decreased → CR 1000 / DR 3100 + realized gain/loss + FX effect
   *
   * Handles partial/full withdrawal with:
   * 1. Cost basis derecognition (at WAC exchange rate)
   * 2. Capital return (at current spot rate)
   * 3. Realized gain or loss
   * 4. FX gain/loss from exchange rate difference between WAC and spot
   */
  private async handleLiquidityDecreased(
    event: DomainEvent<PositionLedgerEventPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, eventId: event.id }, 'No ledger event found for liquidity decrease');
      return;
    }
    const absDeltaCostBasis = absBigint(ledgerEvent.deltaCostBasis);
    const tokenValue = ledgerEvent.tokenValue;
    const deltaPnl = BigInt(ledgerEvent.deltaPnl);

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;
    const spotRate = BigInt(ctx.exchangeRate);
    const decimalsScale = 10n ** BigInt(ctx.quoteTokenDecimals);

    // Query weighted average cost exchange rate for cost basis derecognition
    const wacRate = await this.journalService.getAccountWacExchangeRate(
      ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef, ctx.quoteTokenDecimals
    );
    const costBasisRate = wacRate ?? spotRate;

    // Build lines with spot rate for amountQuote balancing
    const builder = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals);

    // Line 1: Derecognize cost basis (credit 1000)
    builder.credit(ACCOUNT_CODES.LP_POSITION_AT_COST, absDeltaCostBasis, positionRef, instrumentRef);

    // Line 2: Capital returned (debit 3100)
    builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, tokenValue, positionRef, instrumentRef);

    // Line 3: Realized gain or loss
    if (deltaPnl > 0n) {
      builder.credit(ACCOUNT_CODES.REALIZED_GAINS, deltaPnl.toString(), positionRef, instrumentRef);
    } else if (deltaPnl < 0n) {
      builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, (-deltaPnl).toString(), positionRef, instrumentRef);
    }

    const lines = builder.build();

    // Override cost basis line with WAC rate for reporting amounts
    const costBasisLine = lines.find(
      (l) => l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST
    )!;
    const costBasisAtSpot = BigInt(costBasisLine.amountReporting!);
    const costBasisAtWac = (BigInt(absDeltaCostBasis) * costBasisRate) / decimalsScale;
    costBasisLine.amountReporting = costBasisAtWac.toString();
    costBasisLine.exchangeRate = costBasisRate.toString();

    // FX difference: positive means spot > WAC (FX gain), negative means FX loss
    const fxDiff = costBasisAtSpot - costBasisAtWac;

    if (fxDiff !== 0n) {
      // Add FX gain/loss line (reporting-only, amountQuote is "0")
      const fxLine: JournalLineInput = {
        accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
        side: fxDiff > 0n ? 'credit' : 'debit',
        amountQuote: '0',
        amountReporting: (fxDiff < 0n ? -fxDiff : fxDiff).toString(),
        reportingCurrency: ctx.reportingCurrency,
        exchangeRate: ctx.exchangeRate,
        positionRef,
        instrumentRef,
      };
      lines.push(fxLine);
    }

    await this.journalService.createEntry(
      {
        userId,

        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}`,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Liquidity decrease: ${positionRef}`,
      },
      lines
    );
  }

  /**
   * position.fees.collected → DR 3100 / CR 4000
   *
   * All collected fees go directly to Fee Income (4000).
   */
  private async handleFeesCollected(
    event: DomainEvent<PositionLedgerEventPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    // Look up the ledger event by composite ID to get fee amount
    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);

    const totalFees = ledgerEvent ? BigInt(ledgerEvent.deltaCollectedYield) : 0n;
    if (totalFees <= 0n) return;

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;
    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalFees.toString(), positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.FEE_INCOME, totalFees.toString(), positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,

        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: ledgerEvent ? `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${ledgerEvent.id}` : undefined,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Fees collected: ${positionRef}`,
      },
      lines
    );
  }

  /**
   * position.closed → Zero out cost basis remainder
   *
   * The actual withdrawal was handled by decrease/collect events.
   * This handler creates a corrective entry for exchange rate mismatches
   * between deposit and withdrawal time.
   */
  private async handlePositionClosed(
    event: DomainEvent<PositionLifecyclePayload>
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;
    const positionRef = positionHash;

    // Cost basis remainder correction (Account 1000)
    // The quote token balance may be 0 while the reporting currency balance is not,
    // due to different exchange rates at deposit vs withdrawal time. Check both.
    const costBasisCorrectionEventId = `${event.id}:cost-basis-correction`;
    if (!(await this.journalService.isProcessed(costBasisCorrectionEventId))) {
      const costBasisQuote = await this.journalService.getAccountBalance(
        ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef
      );
      const costBasisReporting = await this.journalService.getAccountBalanceReporting(
        ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef
      );

      if (costBasisQuote !== 0n || costBasisReporting !== 0n) {
        const userId = await this.getPositionUserId(positionId);
        const ctx = await this.getReportingContext(positionId);
        const instrumentRef = ctx.poolHash;
        const absQuote = absBigintValue(costBasisQuote).toString();
        const absReporting = absBigintValue(costBasisReporting).toString();
        // Determine direction from whichever balance is non-zero
        // (if quote is 0, the sign comes from reporting; if both non-zero, they agree)
        const isOverCredited = costBasisQuote < 0n || (costBasisQuote === 0n && costBasisReporting < 0n);

        const lines: JournalLineInput[] = isOverCredited
          ? [
              { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'debit', amountQuote: absQuote,
                amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
                exchangeRate: ctx.exchangeRate, positionRef, instrumentRef },
              { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'credit', amountQuote: absQuote,
                amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
                exchangeRate: ctx.exchangeRate, positionRef, instrumentRef },
            ]
          : [
              { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'credit', amountQuote: absQuote,
                amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
                exchangeRate: ctx.exchangeRate, positionRef, instrumentRef },
              { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'debit', amountQuote: absQuote,
                amountReporting: absReporting, reportingCurrency: ctx.reportingCurrency,
                exchangeRate: ctx.exchangeRate, positionRef, instrumentRef },
            ];

        await this.journalService.createEntry(
          {
            userId,

            domainEventId: costBasisCorrectionEventId,
            domainEventType: event.type,
            entryDate: new Date(event.timestamp),
            description: `Cost basis correction: ${positionRef}`,
          },
          lines
        );
      }
    }
  }

  /**
   * position.deleted → Delete all journal entries for the position
   */
  private async handlePositionDeleted(
    event: DomainEvent<PositionLifecyclePayload>
  ): Promise<void> {
    const { positionHash } = event.payload;
    const positionRef = positionHash;
    if (!positionRef) return;

    const count = await this.journalService.deleteEntriesByPositionRef(positionRef);
    this.logger.info(
      { positionRef, deletedCount: count },
      'Deleted journal entries for deleted position'
    );
  }

  /**
   * position.liquidity.reverted → Delete journal entries for reverted ledger events
   */
  private async handleLiquidityReverted(
    event: DomainEvent<PositionLiquidityRevertedPayload>
  ): Promise<void> {
    const { positionId, blockHash } = event.payload;
    const prefix = `${LEDGER_REF_PREFIX.POSITION_LEDGER}:`;

    // Find journal entries for this position that reference position ledger events.
    // Ledger events are already deleted by the time we get this event, so we
    // find entries whose referenced ledger events no longer exist.
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        ledgerEventRef: { startsWith: prefix },
        lines: {
          some: {
            positionRef: event.payload.positionHash,
          },
        },
      },
      select: { id: true, ledgerEventRef: true },
    });

    if (journalEntries.length === 0) return;

    // Strip prefix to get bare cuid for DB lookup
    const refToId = new Map(
      journalEntries.map((e) => [e.ledgerEventRef!, e.ledgerEventRef!.slice(prefix.length)])
    );

    // Check which ledger events still exist
    const existingLedgerIds = new Set(
      (
        await prisma.positionLedgerEvent.findMany({
          where: {
            positionId,
            id: { in: [...refToId.values()] },
          },
          select: { id: true },
        })
      ).map((e) => e.id)
    );

    // Delete journal entries whose ledger events no longer exist (were reverted)
    const orphanedRefs = journalEntries
      .filter((e) => e.ledgerEventRef && !existingLedgerIds.has(refToId.get(e.ledgerEventRef!)!))
      .map((e) => e.ledgerEventRef!);

    if (orphanedRefs.length > 0) {
      const count = await this.journalService.deleteByLedgerEventRefs(orphanedRefs);
      this.logger.info(
        { positionId, blockHash, deletedCount: count },
        'Deleted journal entries for reverted ledger events'
      );
    }
  }

  // ===========================================================================
  // Transfer Handlers
  // ===========================================================================

  /**
   * position.transferred.in → DR 1000 / CR 3000
   *
   * Creates cost basis at FMV when position is received via transfer.
   */
  private async handleTransferredIn(
    event: DomainEvent<PositionLedgerEventPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash, eventId: event.id }, 'No ledger event found for transfer in');
      return;
    }

    const costBasis = ledgerEvent.deltaCostBasis;
    if (costBasis === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;
    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,

        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Transfer in: ${positionRef}`,
      },
      lines
    );
  }

  /**
   * position.transferred.out → CR 1000 / DR 3100 + realized gain/loss + FX effect
   *
   * Derecognizes remaining cost basis and realizes PnL at FMV.
   */
  private async handleTransferredOut(
    event: DomainEvent<PositionLedgerEventPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash, eventId: event.id }, 'No ledger event found for transfer out');
      return;
    }

    const { tokenValue } = ledgerEvent;
    const absDeltaCostBasis = absBigint(ledgerEvent.deltaCostBasis);
    const deltaPnl = BigInt(ledgerEvent.deltaPnl);

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;
    const spotRate = BigInt(ctx.exchangeRate);
    const decimalsScale = 10n ** BigInt(ctx.quoteTokenDecimals);

    // WAC rate for cost basis derecognition (same pattern as handleLiquidityDecreased)
    const wacRate = await this.journalService.getAccountWacExchangeRate(
      ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef, ctx.quoteTokenDecimals
    );
    const costBasisRate = wacRate ?? spotRate;

    const builder = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals);

    // CR 1000: Derecognize remaining cost basis
    builder.credit(ACCOUNT_CODES.LP_POSITION_AT_COST, absDeltaCostBasis, positionRef, instrumentRef);

    // DR 3100: Capital returned at FMV
    builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, tokenValue, positionRef, instrumentRef);

    // Realized gain or loss
    if (deltaPnl > 0n) {
      builder.credit(ACCOUNT_CODES.REALIZED_GAINS, deltaPnl.toString(), positionRef, instrumentRef);
    } else if (deltaPnl < 0n) {
      builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, (-deltaPnl).toString(), positionRef, instrumentRef);
    }

    const lines = builder.build();

    // Override cost basis line with WAC rate for reporting amounts
    const costBasisLine = lines.find(
      (l) => l.accountCode === ACCOUNT_CODES.LP_POSITION_AT_COST
    )!;
    const costBasisAtSpot = BigInt(costBasisLine.amountReporting!);
    const costBasisAtWac = (BigInt(absDeltaCostBasis) * costBasisRate) / decimalsScale;
    costBasisLine.amountReporting = costBasisAtWac.toString();
    costBasisLine.exchangeRate = costBasisRate.toString();

    // FX difference
    const fxDiff = costBasisAtSpot - costBasisAtWac;
    if (fxDiff !== 0n) {
      const fxLine: JournalLineInput = {
        accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
        side: fxDiff > 0n ? 'credit' : 'debit',
        amountQuote: '0',
        amountReporting: (fxDiff < 0n ? -fxDiff : fxDiff).toString(),
        reportingCurrency: ctx.reportingCurrency,
        exchangeRate: ctx.exchangeRate,
        positionRef,
        instrumentRef,
      };
      lines.push(fxLine);
    }

    await this.journalService.createEntry(
      {
        userId,

        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Transfer out: ${positionRef}`,
      },
      lines
    );
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Find a ledger event by its composite input hash (deterministic lookup).
   */
  private async findLedgerEventByInputHash(
    positionId: string,
    inputHash: string,
  ) {
    return prisma.positionLedgerEvent.findFirst({
      where: {
        positionId,
        inputHash,
      },
      select: {
        id: true,
        deltaCostBasis: true,
        costBasisAfter: true,
        deltaPnl: true,
        pnlAfter: true,
        deltaCollectedYield: true,
        collectedYieldAfter: true,
        tokenValue: true,
      },
    });
  }

  /**
   * Get the userId for a position.
   */
  private async getPositionUserId(positionId: string): Promise<string> {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true },
    });
    if (!position) throw new Error(`Position not found: ${positionId}`);
    return position.userId;
  }

  /**
   * Resolve reporting currency context for a position.
   * Fetches the quote token's USD price from CoinGecko and computes the exchange rate.
   * Also returns the poolHash for instrumentRef denormalization.
   */
  private async getReportingContext(positionId: string): Promise<ReportingContext> {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: {
        protocol: true,
        config: true,
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

    // Phase 1: only USD supported. For non-USD, falls back to 1.0.
    const reportingCurrencyUsdPrice = 1.0;

    let quoteTokenUsdPrice = 1.0;
    if (quoteToken.coingeckoId) {
      const prices = await CoinGeckoClient.getInstance().getSimplePrices([quoteToken.coingeckoId]);
      quoteTokenUsdPrice = prices[quoteToken.coingeckoId]?.usd ?? 1.0;
    }

    const rate = quoteTokenUsdPrice / reportingCurrencyUsdPrice;
    const exchangeRate = BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));

    const poolHash = `${position.protocol}/${chainId}/${poolAddress}`;

    return {
      reportingCurrency,
      exchangeRate: exchangeRate.toString(),
      quoteTokenDecimals: quoteToken.decimals,
      poolHash,
    };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Returns the absolute value of a bigint string. */
function absBigint(value: string): string {
  const n = BigInt(value);
  return (n < 0n ? -n : n).toString();
}

/** Returns the absolute value of a bigint. */
function absBigintValue(value: bigint): bigint {
  return value < 0n ? -value : value;
}
