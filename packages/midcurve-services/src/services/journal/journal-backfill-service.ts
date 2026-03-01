/**
 * JournalBackfillService
 *
 * Replays a position's ledger event history to create journal entries
 * with historic exchange rates. Called when a user tracks a position
 * in the accounting system.
 *
 * Handles three ledger event types:
 * - INCREASE_POSITION → DR 1000 / CR 3000 (capital contribution)
 * - DECREASE_POSITION → CR 1000 / DR 3100 + realized PnL + unrealized reclassification
 * - COLLECT           → DR 3100 / CR 4000 (fee income)
 *
 * After replaying ledger events, creates final M2M and fee accrual
 * adjustment entries for active positions.
 */

import { prisma as prismaClient, type PrismaClient } from '@midcurve/database';
import { ACCOUNT_CODES, LEDGER_REF_PREFIX } from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CoinGeckoClient, findClosestPrice } from '../../clients/coingecko/index.js';
import { JournalService } from './journal-service.js';
import { JournalLineBuilder } from './journal-line-builder.js';

// =============================================================================
// Types
// =============================================================================

interface BackfillResult {
  entriesCreated: number;
  eventsProcessed: number;
}

interface ReportingContext {
  reportingCurrency: string;
  exchangeRate: string;
  quoteTokenDecimals: number;
}

interface LedgerEventRow {
  id: string;
  eventType: string;
  timestamp: Date;
  tokenValue: string;
  deltaCostBasis: string;
  costBasisAfter: string;
  deltaPnl: string;
  pnlAfter: string;
  deltaCollectedFees: string;
  collectedFeesAfter: string;
}

const FLOAT_TO_BIGINT_SCALE = 1e8;
const FINANCIAL_EVENT_TYPES = ['INCREASE_POSITION', 'DECREASE_POSITION', 'COLLECT'];

// =============================================================================
// Service
// =============================================================================

export class JournalBackfillService {
  private static instance: JournalBackfillService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;
  private readonly journalService: JournalService;
  private readonly coingecko: CoinGeckoClient;

  constructor(deps?: { prisma?: PrismaClient }) {
    this.prisma = (deps?.prisma ?? prismaClient) as PrismaClient;
    this.logger = createServiceLogger('JournalBackfillService');
    this.journalService = JournalService.getInstance();
    this.coingecko = CoinGeckoClient.getInstance();
  }

  static getInstance(): JournalBackfillService {
    if (!JournalBackfillService.instance) {
      JournalBackfillService.instance = new JournalBackfillService();
    }
    return JournalBackfillService.instance;
  }

  /**
   * Backfill all journal entries for a position from its ledger event history.
   *
   * Called when user tracks a position in accounting.
   * Replays ledger events chronologically, creating journal entries with historic prices.
   * Finishes with a single M2M + fee accrual adjustment entry reflecting current state.
   *
   * @param positionId - Database ID of the position
   * @param userId - Owner user ID
   * @param positionRef - Position hash (e.g., "uniswapv3/42161/5334690")
   * @param instrumentRef - Pool hash (e.g., "uniswapv3/42161/0x8ad5...")
   * @param trackedPositionId - FK to TrackedPosition row
   */
  async backfillPosition(
    positionId: string,
    userId: string,
    positionRef: string,
    instrumentRef: string,
    trackedPositionId: string,
  ): Promise<BackfillResult> {
    // Guard: if entries already exist, skip (already backfilled or live events created entries)
    if (await this.journalService.hasEntriesForPosition(positionRef)) {
      this.logger.info({ positionRef }, 'Skipping backfill — entries already exist');
      return { entriesCreated: 0, eventsProcessed: 0 };
    }

    // Fetch position metadata
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      select: {
        id: true,
        positionHash: true,
        isToken0Quote: true,
        unrealizedPnl: true,
        unClaimedFees: true,
        isActive: true,
        user: { select: { reportingCurrency: true } },
        pool: {
          select: {
            token0: { select: { decimals: true, coingeckoId: true } },
            token1: { select: { decimals: true, coingeckoId: true } },
          },
        },
      },
    });
    if (!position) throw new Error(`Position not found: ${positionId}`);

    // Fetch all ledger events chronologically
    const allEvents = await this.prisma.positionLedgerEvent.findMany({
      where: { positionId },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        eventType: true,
        timestamp: true,
        tokenValue: true,
        deltaCostBasis: true,
        costBasisAfter: true,
        deltaPnl: true,
        pnlAfter: true,
        deltaCollectedFees: true,
        collectedFeesAfter: true,
      },
    });

    // Filter to financial events only
    const financialEvents = allEvents.filter((e) =>
      FINANCIAL_EVENT_TYPES.includes(e.eventType)
    );

    if (financialEvents.length === 0) {
      this.logger.info({ positionRef }, 'No financial ledger events to backfill');
      return { entriesCreated: 0, eventsProcessed: 0 };
    }

    // Resolve quote token info
    const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;
    const reportingCurrency = position.user.reportingCurrency;

    // Fetch historic price time series from CoinGecko
    let priceTimeSeries: [number, number][] = [];
    const firstEvent = financialEvents[0]!;
    const lastEvent = financialEvents[financialEvents.length - 1]!;
    if (quoteToken.coingeckoId) {
      const firstTs = Math.floor(firstEvent.timestamp.getTime() / 1000);
      const lastTs = Math.floor(lastEvent.timestamp.getTime() / 1000);
      const chartData = await this.coingecko.getMarketChartRange(
        quoteToken.coingeckoId,
        firstTs - 3600, // 1 hour buffer before
        lastTs + 3600,  // 1 hour buffer after
      );
      priceTimeSeries = chartData.prices;
    }

    // Replay events chronologically
    let entriesCreated = 0;
    let isFirstFinancialEvent = true;

    for (const event of financialEvents) {
      const ctx = this.computeHistoricReportingContext(
        reportingCurrency,
        quoteToken.decimals,
        quoteToken.coingeckoId,
        priceTimeSeries,
        event.timestamp,
      );

      let created = false;

      switch (event.eventType) {
        case 'INCREASE_POSITION':
          created = await this.backfillLiquidityIncreased(
            event, ctx, positionRef, instrumentRef, userId, trackedPositionId, isFirstFinancialEvent,
          );
          isFirstFinancialEvent = false;
          break;
        case 'DECREASE_POSITION':
          created = await this.backfillLiquidityDecreased(event, ctx, positionRef, instrumentRef, userId, trackedPositionId);
          break;
        case 'COLLECT':
          created = await this.backfillFeesCollected(event, ctx, positionRef, instrumentRef, userId, trackedPositionId);
          break;
      }

      if (created) entriesCreated++;
    }

    // Final adjustment entries for active positions
    if (position.isActive) {
      const spotCtx = await this.getSpotReportingContext(
        reportingCurrency,
        quoteToken.decimals,
        quoteToken.coingeckoId,
      );

      // Fee accrual
      const unClaimedFees = BigInt(position.unClaimedFees ?? '0');
      if (unClaimedFees > 0n) {
        const feeEventId = `backfill:${positionId}:final-fee-accrual`;
        if (!(await this.journalService.isProcessed(feeEventId))) {
          const builder = new JournalLineBuilder()
            .withReporting(spotCtx.reportingCurrency, spotCtx.exchangeRate, spotCtx.quoteTokenDecimals);
          const feesStr = unClaimedFees.toString();
          builder.debit(ACCOUNT_CODES.ACCRUED_FEE_INCOME, feesStr, positionRef, instrumentRef);
          builder.credit(ACCOUNT_CODES.ACCRUED_FEE_INCOME_REVENUE, feesStr, positionRef, instrumentRef);

          await this.journalService.createEntry(
            {
              userId,
              trackedPositionId,
              domainEventId: feeEventId,
              domainEventType: 'backfill.fee-accrual',
              entryDate: new Date(),
              description: `Fee accrual (backfill): ${positionRef}`,
            },
            builder.build(),
          );
          entriesCreated++;
        }
      }

      // M2M unrealized P&L
      const unrealizedPnl = BigInt(position.unrealizedPnl ?? '0');
      if (unrealizedPnl !== 0n) {
        const m2mEventId = `backfill:${positionId}:final-m2m`;
        if (!(await this.journalService.isProcessed(m2mEventId))) {
          const builder = new JournalLineBuilder()
            .withReporting(spotCtx.reportingCurrency, spotCtx.exchangeRate, spotCtx.quoteTokenDecimals);
          const absUnrealized = (unrealizedPnl < 0n ? -unrealizedPnl : unrealizedPnl).toString();

          if (unrealizedPnl > 0n) {
            builder.debit(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, absUnrealized, positionRef, instrumentRef);
            builder.credit(ACCOUNT_CODES.UNREALIZED_GAINS, absUnrealized, positionRef, instrumentRef);
          } else {
            builder.debit(ACCOUNT_CODES.UNREALIZED_LOSSES, absUnrealized, positionRef, instrumentRef);
            builder.credit(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, absUnrealized, positionRef, instrumentRef);
          }

          await this.journalService.createEntry(
            {
              userId,
              trackedPositionId,
              domainEventId: m2mEventId,
              domainEventType: 'backfill.m2m',
              entryDate: new Date(),
              description: `Mark-to-market (backfill): ${positionRef}`,
            },
            builder.build(),
          );
          entriesCreated++;
        }
      }
    }

    this.logger.info(
      { positionRef, entriesCreated, eventsProcessed: financialEvents.length },
      'Backfill complete',
    );

    return { entriesCreated, eventsProcessed: financialEvents.length };
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * INCREASE_POSITION → DR 1000 / CR 3000
   *
   * For the first financial event, uses costBasisAfter (foundation entry).
   * For subsequent events, uses deltaCostBasis.
   */
  private async backfillLiquidityIncreased(
    event: LedgerEventRow,
    ctx: ReportingContext,
    positionRef: string,
    instrumentRef: string,
    userId: string,
    trackedPositionId: string,
    isFoundation: boolean,
  ): Promise<boolean> {
    const domainEventId = isFoundation
      ? `backfill:${event.id}:foundation`
      : `backfill:${event.id}`;

    if (await this.journalService.isProcessed(domainEventId)) return false;

    const costBasis = isFoundation ? event.costBasisAfter : event.deltaCostBasis;
    if (costBasis === '0') return false;

    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.LP_POSITION_AT_COST, costBasis, positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, costBasis, positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,
        trackedPositionId,
        domainEventId,
        domainEventType: isFoundation ? 'position.created' : 'position.liquidity.increased',
        ledgerEventRef: `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${event.id}`,
        entryDate: event.timestamp,
        description: isFoundation
          ? `Position created (backfill): ${positionRef}`
          : `Liquidity increase (backfill): ${positionRef}`,
      },
      lines,
    );

    return true;
  }

  /**
   * DECREASE_POSITION → CR 1000 / DR 3100 + realized gain/loss + unrealized reclassification
   */
  private async backfillLiquidityDecreased(
    event: LedgerEventRow,
    ctx: ReportingContext,
    positionRef: string,
    instrumentRef: string,
    userId: string,
    trackedPositionId: string,
  ): Promise<boolean> {
    const domainEventId = `backfill:${event.id}`;
    if (await this.journalService.isProcessed(domainEventId)) return false;

    const absDeltaCostBasis = absBigint(event.deltaCostBasis);
    const tokenValue = event.tokenValue;
    const deltaPnl = BigInt(event.deltaPnl);

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
      positionRef,
    );

    if (unrealizedBalance !== 0n) {
      const costBasisBefore = BigInt(event.costBasisAfter) + BigInt(absDeltaCostBasis);
      if (costBasisBefore > 0n) {
        const proportion = (BigInt(absDeltaCostBasis) * 10n ** 18n) / costBasisBefore;
        const reclassAmount = (absBigintValue(unrealizedBalance) * proportion) / 10n ** 18n;

        if (reclassAmount > 0n) {
          const reclassStr = reclassAmount.toString();
          if (unrealizedBalance > 0n) {
            builder.debit(ACCOUNT_CODES.UNREALIZED_GAINS, reclassStr, positionRef, instrumentRef);
            builder.credit(ACCOUNT_CODES.REALIZED_GAINS, reclassStr, positionRef, instrumentRef);
          } else {
            builder.credit(ACCOUNT_CODES.UNREALIZED_LOSSES, reclassStr, positionRef, instrumentRef);
            builder.debit(ACCOUNT_CODES.REALIZED_LOSSES, reclassStr, positionRef, instrumentRef);
          }
        }
      }
    }

    await this.journalService.createEntry(
      {
        userId,
        trackedPositionId,
        domainEventId,
        domainEventType: 'position.liquidity.decreased',
        ledgerEventRef: `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${event.id}`,
        entryDate: event.timestamp,
        description: `Liquidity decrease (backfill): ${positionRef}`,
      },
      builder.build(),
    );

    return true;
  }

  /**
   * COLLECT → DR 3100 / CR 4000
   *
   * During backfill, all collected fees go directly to FEE_INCOME (4000).
   * No accrual resolution needed since we skip intermediate M2M/fee accrual entries.
   */
  private async backfillFeesCollected(
    event: LedgerEventRow,
    ctx: ReportingContext,
    positionRef: string,
    instrumentRef: string,
    userId: string,
    trackedPositionId: string,
  ): Promise<boolean> {
    const domainEventId = `backfill:${event.id}`;
    if (await this.journalService.isProcessed(domainEventId)) return false;

    const totalFees = BigInt(event.deltaCollectedFees);
    if (totalFees <= 0n) return false;

    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalFees.toString(), positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.FEE_INCOME, totalFees.toString(), positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,
        trackedPositionId,
        domainEventId,
        domainEventType: 'position.fees.collected',
        ledgerEventRef: `${LEDGER_REF_PREFIX.POSITION_LEDGER}:${event.id}`,
        entryDate: event.timestamp,
        description: `Fees collected (backfill): ${positionRef}`,
      },
      lines,
    );

    return true;
  }

  // ===========================================================================
  // Reporting Context Helpers
  // ===========================================================================

  /**
   * Compute reporting context using historic price from market chart time series.
   */
  private computeHistoricReportingContext(
    reportingCurrency: string,
    quoteTokenDecimals: number,
    quoteCoingeckoId: string | null,
    priceTimeSeries: [number, number][],
    eventTimestamp: Date,
  ): ReportingContext {
    let quoteTokenUsdPrice = 1.0;

    if (quoteCoingeckoId && priceTimeSeries.length > 0) {
      quoteTokenUsdPrice = findClosestPrice(priceTimeSeries, eventTimestamp.getTime());
    }

    // Phase 1: reporting currency is always USD, so reportingCurrencyUsdPrice = 1.0
    const rate = quoteTokenUsdPrice / 1.0;
    const exchangeRate = BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));

    return {
      reportingCurrency,
      exchangeRate: exchangeRate.toString(),
      quoteTokenDecimals,
    };
  }

  /**
   * Compute reporting context using current spot price.
   * Used for final M2M/fee accrual adjustment entries.
   */
  private async getSpotReportingContext(
    reportingCurrency: string,
    quoteTokenDecimals: number,
    quoteCoingeckoId: string | null,
  ): Promise<ReportingContext> {
    let quoteTokenUsdPrice = 1.0;

    if (quoteCoingeckoId) {
      const prices = await this.coingecko.getSimplePrices([quoteCoingeckoId]);
      quoteTokenUsdPrice = prices[quoteCoingeckoId]?.usd ?? 1.0;
    }

    const rate = quoteTokenUsdPrice / 1.0;
    const exchangeRate = BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));

    return {
      reportingCurrency,
      exchangeRate: exchangeRate.toString(),
      quoteTokenDecimals,
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
