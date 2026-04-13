/**
 * UniswapV3 Journal Backfill Service
 *
 * Replays a UniswapV3 position's ledger event history to create journal entries
 * with historic exchange rates. Called when a user tracks a position
 * in the accounting system.
 *
 * Handles four ledger event types:
 * - INCREASE_POSITION → DR 1000 / CR 3000 (capital contribution)
 * - DECREASE_POSITION → CR 1000 / DR 3100 + realized PnL
 * - COLLECT           → DR 3100 / CR 4000 (fee income)
 * - TRANSFER          → DR 1000 / CR 3000 (in) or CR 1000 / DR 3100 + PnL (out)
 *
 * For closed positions, creates a cost basis remainder correction entry.
 *
 * Protocol-specific: assumes two-token EVM pool with ERC-20 tokens and CoinGecko pricing.
 */

import { prisma as prismaClient, type PrismaClient } from '@midcurve/database';
import { ACCOUNT_CODES, createErc20TokenHash, type JournalLineInput } from '@midcurve/shared';
import {
  createServiceLogger,
  type ServiceLogger,
  CoinGeckoClient,
  findClosestPrice,
  JournalService,
  JournalLineBuilder,
} from '@midcurve/services';

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
  deltaCollectedYield: string;
  collectedYieldAfter: string;
  isIgnored: boolean;
}

const FLOAT_TO_BIGINT_SCALE = 1e8;
const FINANCIAL_EVENT_TYPES = ['INCREASE_POSITION', 'DECREASE_POSITION', 'COLLECT', 'TRANSFER'];

// =============================================================================
// Service
// =============================================================================

export class UniswapV3JournalBackfillService {
  private static instance: UniswapV3JournalBackfillService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;
  private readonly journalService: JournalService;
  private readonly coingecko: CoinGeckoClient;

  constructor(deps?: { prisma?: PrismaClient }) {
    this.prisma = (deps?.prisma ?? prismaClient) as PrismaClient;
    this.logger = createServiceLogger('UniswapV3JournalBackfillService');
    this.journalService = JournalService.getInstance();
    this.coingecko = CoinGeckoClient.getInstance();
  }

  static getInstance(): UniswapV3JournalBackfillService {
    if (!UniswapV3JournalBackfillService.instance) {
      UniswapV3JournalBackfillService.instance = new UniswapV3JournalBackfillService();
    }
    return UniswapV3JournalBackfillService.instance;
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
   */
  async backfillPosition(
    positionId: string,
    userId: string,
    positionRef: string,
    instrumentRef: string,
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
        protocol: true,
        positionHash: true,
        state: true,
        config: true,
        user: { select: { reportingCurrency: true } },
      },
    });
    if (!position) throw new Error(`Position not found: ${positionId}`);

    // Vault position guard: skip if not owned by user
    if (position.protocol === 'uniswapv3-vault') {
      const positionState = position.state as Record<string, unknown>;
      if (positionState.isOwnedByUser === false) {
        this.logger.info({ positionRef }, 'Skipping backfill — vault position not owned by user');
        return { entriesCreated: 0, eventsProcessed: 0 };
      }
    }

    // Look up token decimals and coingeckoId from position config
    const positionConfig = position.config as Record<string, unknown>;
    const token0Address = positionConfig.token0Address as string;
    const token1Address = positionConfig.token1Address as string;
    const chainId = positionConfig.chainId as number;

    const [token0Row, token1Row] = await Promise.all([
      this.prisma.token.findUnique({
        where: { tokenHash: createErc20TokenHash(chainId, token0Address) },
        select: { decimals: true, coingeckoId: true, symbol: true },
      }),
      this.prisma.token.findUnique({
        where: { tokenHash: createErc20TokenHash(chainId, token1Address) },
        select: { decimals: true, coingeckoId: true, symbol: true },
      }),
    ]);
    if (!token0Row) throw new Error(`Token not found for address ${token0Address} on chain ${chainId}`);
    if (!token1Row) throw new Error(`Token not found for address ${token1Address} on chain ${chainId}`);

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
        deltaCollectedYield: true,
        collectedYieldAfter: true,
        isIgnored: true,
      },
    });

    // Filter to financial events that are not ignored (within user ownership)
    const financialEvents = allEvents.filter((e) =>
      FINANCIAL_EVENT_TYPES.includes(e.eventType) && !e.isIgnored
    );

    if (financialEvents.length === 0) {
      this.logger.info({ positionRef }, 'No financial ledger events to backfill');
      return { entriesCreated: 0, eventsProcessed: 0 };
    }

    // Resolve quote token info
    const isToken0Quote = positionConfig.isToken0Quote as boolean;
    const quoteToken = isToken0Quote ? token0Row : token1Row;
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
            event, ctx, positionRef, instrumentRef, userId, isFirstFinancialEvent,
          );
          isFirstFinancialEvent = false;
          break;
        case 'DECREASE_POSITION':
          created = await this.backfillLiquidityDecreased(event, ctx, positionRef, instrumentRef, userId);
          break;
        case 'COLLECT':
          created = await this.backfillFeesCollected(event, ctx, positionRef, instrumentRef, userId);
          break;
        case 'TRANSFER': {
          const deltaCB = BigInt(event.deltaCostBasis);
          if (deltaCB < 0n) {
            created = await this.backfillTransferOut(event, ctx, positionRef, instrumentRef, userId);
          } else if (deltaCB > 0n) {
            created = await this.backfillTransferIn(
              event, ctx, positionRef, instrumentRef, userId, isFirstFinancialEvent,
            );
            isFirstFinancialEvent = false;
          }
          break;
        }
      }

      if (created) entriesCreated++;
    }

    // Remainder corrections for closed positions
    // Uses state.isClosed (not isActive — that's only set false on burn)
    const positionState = position.state as Record<string, unknown>;
    const isClosed = positionState.isClosed === true;

    if (isClosed) {
      // Cost basis remainder correction (Account 1000)
      // Check both quote and reporting balances — the mismatch may only exist in reporting
      const costBasisCorrectionEventId = `backfill:${positionId}:cost-basis-correction`;
      if (!(await this.journalService.isProcessed(costBasisCorrectionEventId))) {
        const costBasisQuote = await this.journalService.getAccountBalance(
          ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef,
        );
        const costBasisReporting = await this.journalService.getAccountBalanceReporting(
          ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef,
        );

        if (costBasisQuote !== 0n || costBasisReporting !== 0n) {
          const absQuote = absBigintValue(costBasisQuote).toString();
          const absReporting = absBigintValue(costBasisReporting).toString();
          const isOverCredited = costBasisQuote < 0n || (costBasisQuote === 0n && costBasisReporting < 0n);

          const lines: JournalLineInput[] = isOverCredited
            ? [
                { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'debit', amountQuote: absQuote,
                  amountReporting: absReporting, reportingCurrency, exchangeRate: '100000000',
                  positionRef, instrumentRef },
                { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'credit', amountQuote: absQuote,
                  amountReporting: absReporting, reportingCurrency, exchangeRate: '100000000',
                  positionRef, instrumentRef },
              ]
            : [
                { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'credit', amountQuote: absQuote,
                  amountReporting: absReporting, reportingCurrency, exchangeRate: '100000000',
                  positionRef, instrumentRef },
                { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'debit', amountQuote: absQuote,
                  amountReporting: absReporting, reportingCurrency, exchangeRate: '100000000',
                  positionRef, instrumentRef },
              ];

          await this.journalService.createEntry(
            {
              userId,

              domainEventId: costBasisCorrectionEventId,
              domainEventType: 'position.closed',
              entryDate: new Date(),
              description: `Cost basis correction (backfill): ${positionRef}`,
            },
            lines,
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

        domainEventId,
        domainEventType: isFoundation ? 'position.created' : 'position.liquidity.increased',
        positionLedgerEventId: event.id,
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
   * DECREASE_POSITION → CR 1000 / DR 3100 + realized gain/loss + FX effect
   *
   * Uses weighted average cost exchange rate for cost basis derecognition
   * to minimize exchange rate drift corrections at position close.
   */
  private async backfillLiquidityDecreased(
    event: LedgerEventRow,
    ctx: ReportingContext,
    positionRef: string,
    instrumentRef: string,
    userId: string,

  ): Promise<boolean> {
    const domainEventId = `backfill:${event.id}`;
    if (await this.journalService.isProcessed(domainEventId)) return false;

    const absDeltaCostBasis = absBigint(event.deltaCostBasis);
    const tokenValue = event.tokenValue;
    const deltaPnl = BigInt(event.deltaPnl);

    const spotRate = BigInt(ctx.exchangeRate);
    const decimalsScale = 10n ** BigInt(ctx.quoteTokenDecimals);

    // Query WAC exchange rate for cost basis derecognition
    const wacRate = await this.journalService.getAccountWacExchangeRate(
      ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef, ctx.quoteTokenDecimals
    );
    const costBasisRate = wacRate ?? spotRate;

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

    // FX difference: positive = spot > WAC (FX gain), negative = FX loss
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

        domainEventId,
        domainEventType: 'position.liquidity.decreased',
        positionLedgerEventId: event.id,
        entryDate: event.timestamp,
        description: `Liquidity decrease (backfill): ${positionRef}`,
      },
      lines,
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

  ): Promise<boolean> {
    const domainEventId = `backfill:${event.id}`;
    if (await this.journalService.isProcessed(domainEventId)) return false;

    const totalFees = BigInt(event.deltaCollectedYield);
    if (totalFees <= 0n) return false;

    const lines = new JournalLineBuilder()
      .withReporting(ctx.reportingCurrency, ctx.exchangeRate, ctx.quoteTokenDecimals)
      .debit(ACCOUNT_CODES.CAPITAL_RETURNED, totalFees.toString(), positionRef, instrumentRef)
      .credit(ACCOUNT_CODES.FEE_INCOME, totalFees.toString(), positionRef, instrumentRef)
      .build();

    await this.journalService.createEntry(
      {
        userId,

        domainEventId,
        domainEventType: 'position.fees.collected',
        positionLedgerEventId: event.id,
        entryDate: event.timestamp,
        description: `Fees collected (backfill): ${positionRef}`,
      },
      lines,
    );

    return true;
  }

  /**
   * TRANSFER (incoming) → DR 1000 / CR 3000
   *
   * Creates cost basis at FMV when position is received via transfer.
   * Mirrors backfillLiquidityIncreased.
   */
  private async backfillTransferIn(
    event: LedgerEventRow,
    ctx: ReportingContext,
    positionRef: string,
    instrumentRef: string,
    userId: string,

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

        domainEventId,
        domainEventType: isFoundation ? 'position.created' : 'position.transferred.in',
        positionLedgerEventId: event.id,
        entryDate: event.timestamp,
        description: isFoundation
          ? `Position received (backfill): ${positionRef}`
          : `Transfer in (backfill): ${positionRef}`,
      },
      lines,
    );

    return true;
  }

  /**
   * TRANSFER (outgoing) → CR 1000 / DR 3100 + realized gain/loss + FX effect
   *
   * Derecognizes remaining cost basis and realizes PnL at FMV.
   * Mirrors backfillLiquidityDecreased.
   */
  private async backfillTransferOut(
    event: LedgerEventRow,
    ctx: ReportingContext,
    positionRef: string,
    instrumentRef: string,
    userId: string,

  ): Promise<boolean> {
    const domainEventId = `backfill:${event.id}`;
    if (await this.journalService.isProcessed(domainEventId)) return false;

    const absDeltaCostBasis = absBigint(event.deltaCostBasis);
    const tokenValue = event.tokenValue;
    const deltaPnl = BigInt(event.deltaPnl);

    const spotRate = BigInt(ctx.exchangeRate);
    const decimalsScale = 10n ** BigInt(ctx.quoteTokenDecimals);

    // WAC rate for cost basis derecognition
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

        domainEventId,
        domainEventType: 'position.transferred.out',
        positionLedgerEventId: event.id,
        entryDate: event.timestamp,
        description: `Transfer out (backfill): ${positionRef}`,
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
