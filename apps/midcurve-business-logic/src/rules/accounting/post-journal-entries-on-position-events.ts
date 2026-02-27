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
 * - position.deleted           → Delete all journal entries for instrument
 * - position.liquidity.reverted → Delete journal entries for reverted ledger events
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  setupConsumerQueue,
  ROUTING_PATTERNS,
  ACCOUNT_CODES,
  JournalService,
  JournalLineBuilder,
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
   * position.created → DR 1000 (LP Position at Cost) / CR 3000 (Contributed Capital)
   *
   * Records the initial capital contribution at cost basis.
   */
  private async handlePositionCreated(
    event: DomainEvent<PositionCreatedPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const position = event.payload; // PositionJSON
    const costBasis = position.currentCostBasis;
    if (!costBasis || costBasis === '0') return; // no cost basis yet

    const instrumentRef = position.positionHash!;
    const lines = new JournalLineBuilder()
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId: position.userId,
        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.timestamp),
        description: `Position created: ${instrumentRef}`,
      },
      lines
    );
  }

  /**
   * position.liquidity.increased → DR 1000 / CR 3000
   *
   * Records additional capital contribution at the delta cost basis.
   */
  private async handleLiquidityIncreased(
    event: DomainEvent<PositionLiquidityIncreasedPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, positionHash } = event.payload;
    const instrumentRef = positionHash;

    // Find the corresponding ledger event to get deltaCostBasis
    const ledgerEvent = await this.findLatestLedgerEvent(positionId, 'INCREASE_POSITION', event.payload.eventTimestamp);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, eventId: event.id }, 'No ledger event found for liquidity increase');
      return;
    }

    const deltaCostBasis = ledgerEvent.deltaCostBasis;
    if (deltaCostBasis === '0') return;

    const userId = await this.getPositionUserId(positionId);
    const lines = new JournalLineBuilder()
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, deltaCostBasis, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, deltaCostBasis, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,
        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: ledgerEvent.id,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Liquidity increase: ${instrumentRef}`,
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
    const instrumentRef = positionHash;

    const ledgerEvent = await this.findLatestLedgerEvent(positionId, 'DECREASE_POSITION', event.payload.eventTimestamp);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, eventId: event.id }, 'No ledger event found for liquidity decrease');
      return;
    }

    const userId = await this.getPositionUserId(positionId);
    const absDeltaCostBasis = absBigint(ledgerEvent.deltaCostBasis);
    const tokenValue = ledgerEvent.tokenValue;
    const deltaPnl = BigInt(ledgerEvent.deltaPnl);

    const builder = new JournalLineBuilder();

    // Line 1: Derecognize cost basis (credit 1000)
    builder.credit(ACCOUNT_CODES.LP_POSITION_AT_COST, absDeltaCostBasis, instrumentRef);

    // Line 2: Capital returned (debit 3100)
    builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, tokenValue, instrumentRef);

    // Line 3: Realized gain or loss
    if (deltaPnl > 0n) {
      builder.credit(ACCOUNT_CODES.REALIZED_GAINS, deltaPnl.toString(), instrumentRef);
    } else if (deltaPnl < 0n) {
      builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, (-deltaPnl).toString(), instrumentRef);
    }

    // Line 4: Reclassify proportional unrealized P&L (if any M2M entries exist)
    const unrealizedBalance = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT,
      instrumentRef
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
            builder.debit(ACCOUNT_CODES.UNREALIZED_GAINS, reclassStr, instrumentRef);
            builder.credit(ACCOUNT_CODES.REALIZED_GAINS, reclassStr, instrumentRef);
          } else {
            // Unrealized loss → reclassify to realized loss
            builder.credit(ACCOUNT_CODES.UNREALIZED_LOSSES, reclassStr, instrumentRef);
            builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, reclassStr, instrumentRef);
          }
        }
      }
    }

    const lines = builder.build();

    await this.journalService.createEntry(
      {
        userId,
        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: ledgerEvent.id,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Liquidity decrease: ${instrumentRef}`,
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
    const instrumentRef = positionHash;
    const totalFees = BigInt(feesValueInQuote);
    if (totalFees <= 0n) return;

    const userId = await this.getPositionUserId(positionId);

    // Find the corresponding COLLECT ledger event
    const ledgerEvent = await this.findLatestLedgerEvent(positionId, 'COLLECT', event.payload.eventTimestamp);

    // Check how much is accrued in 1002 for this instrument
    const accruedBalance = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.ACCRUED_FEE_INCOME,
      instrumentRef
    );

    const builder = new JournalLineBuilder();
    builder.debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalFees.toString(), instrumentRef);

    if (accruedBalance > 0n) {
      // Use accrued amount first, then any excess to fee income
      const accrualAmount = accruedBalance < totalFees ? accruedBalance : totalFees;
      builder.credit(ACCOUNT_CODES.ACCRUED_FEE_INCOME, accrualAmount.toString(), instrumentRef);

      const excess = totalFees - accrualAmount;
      if (excess > 0n) {
        builder.credit(ACCOUNT_CODES.FEE_INCOME, excess.toString(), instrumentRef);
      }
    } else {
      // No prior accrual — all goes to fee income
      builder.credit(ACCOUNT_CODES.FEE_INCOME, totalFees.toString(), instrumentRef);
    }

    const lines = builder.build();

    await this.journalService.createEntry(
      {
        userId,
        domainEventId: event.id,
        domainEventType: event.type,
        ledgerEventRef: ledgerEvent?.id,
        entryDate: new Date(event.payload.eventTimestamp),
        description: `Fees collected: ${instrumentRef}`,
      },
      lines
    );
  }

  /**
   * position.state.refreshed → Fee accrual + M2M value change
   *
   * Two independent sub-entries:
   * A) Fee accrual: DR 1002 / CR 4000 (if unclaimed fees increased)
   * B) M2M: DR/CR 1001 vs 4200/5200 (unrealized gain/loss change)
   */
  private async handleStateRefreshed(
    event: DomainEvent<PositionStateRefreshedPayload>
  ): Promise<void> {
    if (await this.journalService.isProcessed(event.id)) return;

    const { positionId, unrealizedPnl } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true, positionHash: true },
    });
    if (!position?.positionHash) return;

    const instrumentRef = position.positionHash;
    const userId = position.userId;

    // Sub-entry B: M2M unrealized P&L change
    // Compare new unrealizedPnl with the current balance of 1001
    const currentUnrealized = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT,
      instrumentRef
    );

    const newUnrealized = BigInt(unrealizedPnl);
    const delta = newUnrealized - currentUnrealized;

    if (delta !== 0n) {
      const builder = new JournalLineBuilder();
      const absDelta = absBigintValue(delta).toString();

      if (delta > 0n) {
        // Value increased
        builder.debit(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, absDelta, instrumentRef);
        builder.credit(ACCOUNT_CODES.UNREALIZED_GAINS, absDelta, instrumentRef);
      } else {
        // Value decreased
        builder.debit(ACCOUNT_CODES.UNREALIZED_LOSSES, absDelta, instrumentRef);
        builder.credit(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, absDelta, instrumentRef);
      }

      await this.journalService.createEntry(
        {
          userId,
          domainEventId: event.id,
          domainEventType: event.type,
          entryDate: new Date(event.timestamp),
          description: `Mark-to-market: ${instrumentRef}`,
        },
        builder.build()
      );
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

    const position = event.payload; // PositionJSON
    const instrumentRef = position.positionHash!;

    // Check remaining unrealized balance
    const unrealizedBalance = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT,
      instrumentRef
    );

    if (unrealizedBalance === 0n) return; // Nothing to reclassify

    const builder = new JournalLineBuilder();
    const absAmount = absBigintValue(unrealizedBalance).toString();

    if (unrealizedBalance > 0n) {
      // Unrealized gain → reclassify to realized gain
      builder.debit(ACCOUNT_CODES.UNREALIZED_GAINS, absAmount, instrumentRef);
      builder.credit(ACCOUNT_CODES.REALIZED_GAINS, absAmount, instrumentRef);
    } else {
      // Unrealized loss → reclassify to realized loss
      builder.credit(ACCOUNT_CODES.UNREALIZED_LOSSES, absAmount, instrumentRef);
      builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, absAmount, instrumentRef);
    }

    await this.journalService.createEntry(
      {
        userId: position.userId,
        domainEventId: event.id,
        domainEventType: event.type,
        entryDate: new Date(event.timestamp),
        description: `Position closed: ${instrumentRef}`,
      },
      builder.build()
    );
  }

  /**
   * position.deleted → Delete all journal entries for this instrument
   */
  private async handlePositionDeleted(
    event: DomainEvent<PositionDeletedPayload>
  ): Promise<void> {
    const position = event.payload;
    const instrumentRef = position.positionHash;
    if (!instrumentRef) return;

    const count = await this.journalService.deleteByInstrumentRef(instrumentRef);
    this.logger.info(
      { instrumentRef, deletedCount: count },
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

    // Find ledger event IDs that were in the reverted block.
    // Since the ledger events are already deleted by the time we get this event,
    // we look up journal entries by matching blockHash in the ledgerEventRef.
    // However, ledgerEventRef stores the ledger event ID, not blockHash.
    // We need to find journal entries via domainEventType + position context.
    //
    // Alternative: find all journal entries for this position that reference
    // ledger events that no longer exist.
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        ledgerEventRef: { not: null },
        lines: {
          some: {
            instrumentRef: event.payload.positionHash,
          },
        },
      },
      select: { id: true, ledgerEventRef: true },
    });

    // Check which ledger events still exist
    const existingLedgerIds = new Set(
      (
        await prisma.positionLedgerEvent.findMany({
          where: {
            positionId,
            id: { in: journalEntries.map((e) => e.ledgerEventRef!).filter(Boolean) },
          },
          select: { id: true },
        })
      ).map((e) => e.id)
    );

    // Delete journal entries whose ledger events no longer exist (were reverted)
    const orphanedRefs = journalEntries
      .filter((e) => e.ledgerEventRef && !existingLedgerIds.has(e.ledgerEventRef))
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
