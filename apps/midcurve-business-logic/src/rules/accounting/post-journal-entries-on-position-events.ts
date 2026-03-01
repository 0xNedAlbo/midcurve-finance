/**
 * PostJournalEntriesOnPositionEventsRule
 *
 * Subscribes to all position domain events and creates balanced double-entry
 * journal entries in the accounting schema.
 *
 * Events handled:
 * - position.created           → DR 1000 / CR 3000 (capital contribution)
 * - position.liquidity.increased → DR 1000 / CR 3000 (additional capital)
 * - position.liquidity.decreased → CR 1000 / DR 3100 + realized gain/loss + unrealized reclassification
 * - position.fees.collected    → DR 3100 / CR 1002 or 4000 (fee collection)
 * - position.state.refreshed   → Fee accrual + M2M adjustment
 * - position.closed            → Reclassify remaining unrealized → realized
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
  JournalLineBuilder,
  CoinGeckoClient,
  type DomainEvent,
  type PositionEventType,
  type PositionCreatedPayload,
  type PositionClosedPayload,
  type PositionDeletedPayload,
  type PositionLiquidityIncreasedPayload,
  type PositionLiquidityDecreasedPayload,
  type PositionFeesCollectedPayload,
  type PositionStateRefreshedPayload,
  type PositionLiquidityRevertedPayload,
} from '@midcurve/services';
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

  constructor() {
    super();
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
        return this.handlePositionCreated(event as DomainEvent<PositionCreatedPayload>);
      case 'position.liquidity.increased':
        return this.handleLiquidityIncreased(event as DomainEvent<PositionLiquidityIncreasedPayload>);
      case 'position.liquidity.decreased':
        return this.handleLiquidityDecreased(event as DomainEvent<PositionLiquidityDecreasedPayload>);
      case 'position.fees.collected':
        return this.handleFeesCollected(event as DomainEvent<PositionFeesCollectedPayload>);
      case 'position.state.refreshed':
        return this.handleStateRefreshed(event as DomainEvent<PositionStateRefreshedPayload>);
      case 'position.closed':
        return this.handlePositionClosed(event as DomainEvent<PositionClosedPayload>);
      case 'position.burned':
        // No financial entry — gas tracking deferred to Phase 2
        return;
      case 'position.deleted':
        return this.handlePositionDeleted(event as DomainEvent<PositionDeletedPayload>);
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
   * position.created → Track position + DR 1000 / CR 3000 (if cost basis available)
   *
   * Always registers the position for tracking. Creates the foundation entry
   * only if costBasis > 0 (which may not be the case for MINT-then-increase flows).
   */
  private async handlePositionCreated(
    event: DomainEvent<PositionCreatedPayload>
  ): Promise<void> {
    const position = event.payload;
    const positionRef = position.positionHash;

    // Always track — even if costBasis is 0
    const trackedPositionId = await this.journalService.trackPosition(position.userId, positionRef);

    if (await this.journalService.isProcessed(event.id)) return;

    const costBasis = position.currentCostBasis;
    if (!costBasis || costBasis === '0') return;

    const ctx = await this.getReportingContext(position.id);
    const instrumentRef = ctx.poolHash;
    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId: position.userId,
        trackedPositionId,
        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.timestamp),
        description: `Position created: ${positionRef}`,
      },
      lines
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
    event: DomainEvent<PositionLiquidityIncreasedPayload>
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const trackedPositionId = await this.journalService.getTrackedPositionId(userId, positionRef);
    if (!trackedPositionId) return;

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;

    // If tracked but no journal entries exist yet, the foundation entry was missed
    // (costBasis was 0 at position.created time). Create it now.
    const foundationEventId = `${event.id}:foundation`;
    if (!(await this.journalService.hasEntriesForPosition(positionRef))) {
      if (!(await this.journalService.isProcessed(foundationEventId))) {
        const position = await prisma.position.findUnique({
          where: { id: positionId },
          select: { currentCostBasis: true },
        });

        const costBasis = position?.currentCostBasis ?? '0';
        if (costBasis !== '0') {
          const lines = new JournalLineBuilder()
            .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
            .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, positionRef, instrumentRef)
            .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, positionRef, instrumentRef)
            .build();

          await this.journalService.createEntry(
            {
              userId,
              trackedPositionId,
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

    // Find the corresponding ledger event to get deltaCostBasis
    const ledgerEvent = await this.findLatestLedgerEvent(positionId, 'INCREASE_POSITION', event.payload.eventTimestamp);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, eventId: event.id }, 'No ledger event found for liquidity increase');
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
        trackedPositionId,
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
   * position.liquidity.decreased → CR 1000 / DR 3100 + realized gain/loss
   *                                + unrealized reclassification
   *
   * The most complex handler. Handles partial/full withdrawal with:
   * 1. Cost basis derecognition
   * 2. Capital return
   * 3. Realized gain or loss
   * 4. Reclassification of proportional unrealized P&L
   */
  private async handleLiquidityDecreased(
    event: DomainEvent<PositionLiquidityDecreasedPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const trackedPositionId = await this.journalService.getTrackedPositionId(userId, positionRef);
    if (!trackedPositionId) return;

    const ledgerEvent = await this.findLatestLedgerEvent(positionId, 'DECREASE_POSITION', event.payload.eventTimestamp);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, eventId: event.id }, 'No ledger event found for liquidity decrease');
      return;
    }
    const absDeltaCostBasis = absBigint(ledgerEvent.deltaCostBasis);
    const tokenValue = ledgerEvent.tokenValue;
    const deltaPnl = BigInt(ledgerEvent.deltaPnl);

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;
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

    // Line 4: Reclassify proportional unrealized P&L (if any M2M entries exist)
    const unrealizedBalance = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT,
      positionRef
    );

    if (unrealizedBalance !== 0n) {
      // Calculate proportion: abs(deltaCostBasis) / costBasisBefore
      const costBasisBefore = BigInt(ledgerEvent.costBasisAfter) + BigInt(absDeltaCostBasis);
      if (costBasisBefore > 0n) {
        const proportion = (BigInt(absDeltaCostBasis) * 10n ** 18n) / costBasisBefore;
        const reclassAmount = (absBigintValue(unrealizedBalance) * proportion) / 10n ** 18n;

        if (reclassAmount > 0n) {
          const reclassStr = reclassAmount.toString();
          if (unrealizedBalance > 0n) {
            // Unrealized gain → reclassify to realized gain
            builder.debit(ACCOUNT_CODES.UNREALIZED_GAINS, reclassStr, positionRef, instrumentRef);
            builder.credit(ACCOUNT_CODES.REALIZED_GAINS, reclassStr, positionRef, instrumentRef);
          } else {
            // Unrealized loss → reclassify to realized loss
            builder.credit(ACCOUNT_CODES.UNREALIZED_LOSSES, reclassStr, positionRef, instrumentRef);
            builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, reclassStr, positionRef, instrumentRef);
          }
        }
      }
    }

    const lines = builder.build();

    await this.journalService.createEntry(
      {
        userId,
        trackedPositionId,
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
   * position.fees.collected → DR 3100 / CR 1002 or 4000
   *
   * Resolves accrued fee income. If fees were previously accrued (via M2M),
   * credits account 1002. Any excess goes to Fee Income (4000).
   */
  private async handleFeesCollected(
    event: DomainEvent<PositionFeesCollectedPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash, feesValueInQuote } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const trackedPositionId = await this.journalService.getTrackedPositionId(userId, positionRef);
    if (!trackedPositionId) return;

    const totalFees = BigInt(feesValueInQuote);
    if (totalFees <= 0n) return;

    // Find the corresponding COLLECT ledger event
    const ledgerEvent = await this.findLatestLedgerEvent(positionId, 'COLLECT', event.payload.eventTimestamp);

    // Check how much is accrued in 1002 for this position
    const accruedBalance = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.ACCRUED_FEE_INCOME,
      positionRef
    );

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;
    const builder = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals);
    builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalFees.toString(), positionRef, instrumentRef);

    if (accruedBalance > 0n) {
      // Use accrued amount first, then any excess to fee income
      const accrualAmount = accruedBalance < totalFees ? accruedBalance : totalFees;
      builder.credit(ACCOUNT_CODES.ACCRUED_FEE_INCOME, accrualAmount.toString(), positionRef, instrumentRef);

      const excess = totalFees - accrualAmount;
      if (excess > 0n) {
        builder.credit(ACCOUNT_CODES.FEE_INCOME, excess.toString(), positionRef, instrumentRef);
      }
    } else {
      // No prior accrual — all goes to fee income
      builder.credit(ACCOUNT_CODES.FEE_INCOME, totalFees.toString(), positionRef, instrumentRef);
    }

    const lines = builder.build();

    await this.journalService.createEntry(
      {
        userId,
        trackedPositionId,
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
   * position.state.refreshed → Fee accrual + M2M value change
   *
   * Two independent sub-entries (each with its own suffixed domainEventId):
   * A) Fee accrual: DR 1002 / CR 4001 (if unclaimed fees increased)
   * B) M2M: DR/CR 1001 vs 4200/5200 (unrealized gain/loss change)
   */
  private async handleStateRefreshed(
    event: DomainEvent<PositionStateRefreshedPayload>
  ): Promise<void> {
    const { positionId, positionHash, unrealizedPnl, unClaimedFees } = event.payload;
    const positionRef = positionHash;
    const userId = await this.getPositionUserId(positionId);

    const trackedPositionId = await this.journalService.getTrackedPositionId(userId, positionRef);
    if (!trackedPositionId) return;

    const ctx = await this.getReportingContext(positionId);
    const instrumentRef = ctx.poolHash;

    // Sub-entry A: Fee accrual
    // Compare current unclaimed fees with what's already accrued in account 1002
    const feeAccrualEventId = `${event.id}:fee-accrual`;
    if (!(await this.journalService.isProcessed(feeAccrualEventId))) {
      const currentAccrued = await this.journalService.getAccountBalance(
        ACCOUNT_CODES.ACCRUED_FEE_INCOME,
        positionRef
      );

      const newUnclaimedFees = BigInt(unClaimedFees);
      const feeDelta = newUnclaimedFees - currentAccrued;

      if (feeDelta > 0n) {
        const feeBuilder = new JournalLineBuilder()
          .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals);
        const feeDeltaStr = feeDelta.toString();
        feeBuilder.debit(ACCOUNT_CODES.ACCRUED_FEE_INCOME, feeDeltaStr, positionRef, instrumentRef);
        feeBuilder.credit(ACCOUNT_CODES.ACCRUED_FEE_INCOME_REVENUE, feeDeltaStr, positionRef, instrumentRef);

        await this.journalService.createEntry(
          {
            userId,
            trackedPositionId,
            domainEventId: feeAccrualEventId,
            domainEventType: event.type,
            entryDate: new Date(event.timestamp),
            description: `Fee accrual: ${positionRef}`,
          },
          feeBuilder.build()
        );
      }
    }

    // Sub-entry B: M2M unrealized P&L change
    // Compare new unrealizedPnl with the current balance of 1001
    const m2mEventId = `${event.id}:m2m`;
    if (!(await this.journalService.isProcessed(m2mEventId))) {
      const currentUnrealized = await this.journalService.getAccountBalance(
        ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT,
        positionRef
      );

      const newUnrealized = BigInt(unrealizedPnl);
      const delta = newUnrealized - currentUnrealized;

      if (delta !== 0n) {
        const builder = new JournalLineBuilder()
          .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals);
        const absDelta = absBigintValue(delta).toString();

        if (delta > 0n) {
          // Value increased
          builder.debit(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, absDelta, positionRef, instrumentRef);
          builder.credit(ACCOUNT_CODES.UNREALIZED_GAINS, absDelta, positionRef, instrumentRef);
        } else {
          // Value decreased
          builder.debit(ACCOUNT_CODES.UNREALIZED_LOSSES, absDelta, positionRef, instrumentRef);
          builder.credit(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, absDelta, positionRef, instrumentRef);
        }

        await this.journalService.createEntry(
          {
            userId,
            trackedPositionId,
            domainEventId: m2mEventId,
            domainEventType: event.type,
            entryDate: new Date(event.timestamp),
            description: `Mark-to-market: ${positionRef}`,
          },
          builder.build()
        );
      }
    }
  }

  /**
   * position.closed → Reclassify remaining unrealized → realized
   *
   * The actual withdrawal was handled by decrease/collect events.
   * This entry zeroes out any remaining unrealized P&L.
   */
  private async handlePositionClosed(
    event: DomainEvent<PositionClosedPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const position = event.payload;
    const positionRef = position.positionHash;

    const trackedPositionId = await this.journalService.getTrackedPositionId(position.userId, positionRef);
    if (!trackedPositionId) return;

    // Check remaining unrealized balance
    const unrealizedBalance = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT,
      positionRef
    );

    if (unrealizedBalance === 0n) return; // Nothing to reclassify

    const ctx = await this.getReportingContext(position.id);
    const instrumentRef = ctx.poolHash;
    const builder = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals);
    const absAmount = absBigintValue(unrealizedBalance).toString();

    if (unrealizedBalance > 0n) {
      // Unrealized gain → reclassify to realized gain
      builder.debit(ACCOUNT_CODES.UNREALIZED_GAINS, absAmount, positionRef, instrumentRef);
      builder.credit(ACCOUNT_CODES.REALIZED_GAINS, absAmount, positionRef, instrumentRef);
    } else {
      // Unrealized loss → reclassify to realized loss
      builder.credit(ACCOUNT_CODES.UNREALIZED_LOSSES, absAmount, positionRef, instrumentRef);
      builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, absAmount, positionRef, instrumentRef);
    }

    await this.journalService.createEntry(
      {
        userId: position.userId,
        trackedPositionId,
        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.timestamp),
        description: `Position closed: ${positionRef}`,
      },
      builder.build()
    );
  }

  /**
   * position.deleted → Untrack position (cascade deletes all journal entries)
   */
  private async handlePositionDeleted(
    event: DomainEvent<PositionDeletedPayload>
  ): Promise<void> {
    const position = event.payload;
    const positionRef = position.positionHash;
    if (!positionRef) return;

    // Deleting the TrackedPosition cascades to all JournalEntries and JournalLines
    await this.journalService.untrackPosition(position.userId, positionRef);
    this.logger.info(
      { positionRef },
      'Untracked position (cascade deleted journal entries)'
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
  // Helpers
  // ===========================================================================

  /**
   * Find the most recent ledger event for a position matching the given event type
   * and close to the given timestamp.
   */
  private async findLatestLedgerEvent(
    positionId: string,
    eventType: string,
    eventTimestamp: string
  ) {
    return prisma.positionLedgerEvent.findFirst({
      where: {
        positionId,
        eventType,
        timestamp: new Date(eventTimestamp),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deltaCostBasis: true,
        costBasisAfter: true,
        deltaPnl: true,
        pnlAfter: true,
        deltaCollectedFees: true,
        collectedFeesAfter: true,
        tokenValue: true,
        token0Amount: true,
        token1Amount: true,
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
        isToken0Quote: true,
        user: { select: { reportingCurrency: true } },
        pool: {
          select: {
            poolHash: true,
            token0: { select: { decimals: true, coingeckoId: true } },
            token1: { select: { decimals: true, coingeckoId: true } },
          },
        },
      },
    });
    if (!position) throw new Error(`Position not found: ${positionId}`);

    const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;
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

    return {
      reportingCurrency,
      exchangeRate: exchangeRate.toString(),
      quoteTokenDecimals: quoteToken.decimals,
      poolHash: position.pool.poolHash ?? '',
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
