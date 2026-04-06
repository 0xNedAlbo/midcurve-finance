/**
 * ReconcileCostBasisCorrectionsRule
 *
 * Scheduled rule that finds closed tracked positions with non-zero
 * LP_POSITION_AT_COST balance and creates the missing cost basis correction
 * entries.
 *
 * This handles cases where the position.closed domain event was lost or
 * failed processing (e.g., CoinGecko API error during getReportingContext).
 *
 * Schedule: Every hour at minute 42
 */

import { prisma } from '@midcurve/database';
import {
  ACCOUNT_CODES,
  JournalService,
  CoinGeckoClient,
} from '@midcurve/services';
import { createErc20TokenHash, type JournalLineInput } from '@midcurve/shared';
import { BusinessRule } from '../base';
import { ruleLog } from '../../lib/logger';

const FLOAT_TO_BIGINT_SCALE = 1e8;

export class ReconcileCostBasisCorrectionsRule extends BusinessRule {
  readonly ruleName = 'reconcile-cost-basis-corrections';
  readonly ruleDescription =
    'Periodically fixes missing cost basis corrections for closed tracked positions';

  private readonly journalService: JournalService;

  constructor() {
    super();
    this.journalService = JournalService.getInstance();
  }

  protected async onStartup(): Promise<void> {
    this.registerSchedule(
      '42 * * * *',
      'Reconcile missing cost basis corrections for closed positions',
      () => this.executeReconciliation(),
      { timezone: 'UTC', runOnStart: true }
    );

    this.logger.info(
      { schedule: '42 * * * * (UTC)' },
      'Registered cost basis correction reconciliation schedule'
    );
  }

  protected async onShutdown(): Promise<void> {
    // Schedules are automatically cleaned up by the base class
  }

  private async executeReconciliation(): Promise<void> {
    ruleLog.eventProcessing(
      this.logger,
      this.ruleName,
      'scheduled-reconciliation',
      'cost-basis-corrections'
    );

    const startTime = Date.now();

    // Find all tracked positions where the underlying position is closed
    const trackedPositions = await prisma.trackedPosition.findMany({
      select: {
        id: true,
        userId: true,
        positionRef: true,
      },
    });

    if (trackedPositions.length === 0) return;

    // Find which positions are actually closed by joining with Position table
    // TrackedPosition.positionRef matches Position.positionHash
    let correctionCount = 0;

    for (const tracked of trackedPositions) {
      const corrected = await this.reconcilePosition(tracked);
      if (corrected) correctionCount++;
    }

    const durationMs = Date.now() - startTime;

    if (correctionCount > 0) {
      this.logger.info(
        { correctionCount, checkedCount: trackedPositions.length, durationMs },
        'Cost basis reconciliation completed with corrections'
      );
    }

    ruleLog.eventProcessed(
      this.logger,
      this.ruleName,
      'scheduled-reconciliation',
      'cost-basis-corrections',
      durationMs
    );
  }

  private async reconcilePosition(tracked: {
    id: string;
    userId: string;
    positionRef: string;
  }): Promise<boolean> {
    const { id: trackedPositionId, userId, positionRef } = tracked;

    // Find the position by positionHash to check if it's closed
    const position = await prisma.position.findFirst({
      where: { userId, positionHash: positionRef },
      select: {
        id: true,
        state: true,
        protocol: true,
        config: true,
        user: { select: { reportingCurrency: true } },
      },
    });

    if (!position) return false;

    // Check if position is closed
    const state = position.state as Record<string, unknown>;
    if (state.isClosed !== true) return false;

    // Check if correction already exists (idempotency)
    const correctionEventId = `reconcile:${positionRef}:cost-basis-correction`;
    if (await this.journalService.isProcessed(correctionEventId)) return false;

    // Also check if a backfill or live correction already exists
    const backfillCorrectionId = `backfill:${position.id}:cost-basis-correction`;
    if (await this.journalService.isProcessed(backfillCorrectionId)) return false;

    // Check LP_POSITION_AT_COST balance
    const costBasisQuote = await this.journalService.getAccountBalance(
      ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef,
    );
    const costBasisReporting = await this.journalService.getAccountBalanceReporting(
      ACCOUNT_CODES.LP_POSITION_AT_COST, positionRef,
    );

    // Nothing to correct
    if (costBasisQuote === 0n && costBasisReporting === 0n) return false;

    // Build reporting context from position config
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
    const instrumentRef = `${position.protocol}/${chainId}/${poolAddress}`;

    let quoteTokenUsdPrice = 1.0;
    if (quoteToken.coingeckoId) {
      const prices = await CoinGeckoClient.getInstance().getSimplePrices([quoteToken.coingeckoId]);
      quoteTokenUsdPrice = prices[quoteToken.coingeckoId]?.usd ?? 1.0;
    }
    const exchangeRate = BigInt(Math.round(quoteTokenUsdPrice * FLOAT_TO_BIGINT_SCALE)).toString();

    const absQuote = absBigintValue(costBasisQuote).toString();
    const absReporting = absBigintValue(costBasisReporting).toString();
    const isOverCredited = costBasisQuote < 0n || (costBasisQuote === 0n && costBasisReporting < 0n);

    const lines: JournalLineInput[] = isOverCredited
      ? [
          { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'debit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency, exchangeRate,
            positionRef, instrumentRef },
          { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'credit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency, exchangeRate,
            positionRef, instrumentRef },
        ]
      : [
          { accountCode: ACCOUNT_CODES.LP_POSITION_AT_COST, side: 'credit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency, exchangeRate,
            positionRef, instrumentRef },
          { accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, side: 'debit', amountQuote: absQuote,
            amountReporting: absReporting, reportingCurrency, exchangeRate,
            positionRef, instrumentRef },
        ];

    await this.journalService.createEntry(
      {
        userId,
        trackedPositionId,
        domainEventId: correctionEventId,
        domainEventType: 'position.closed',
        entryDate: new Date(),
        description: `Cost basis correction (reconciled): ${positionRef}`,
      },
      lines,
    );

    this.logger.info(
      { positionRef, costBasisQuote: costBasisQuote.toString(), costBasisReporting: costBasisReporting.toString() },
      'Created missing cost basis correction'
    );

    return true;
  }
}

function absBigintValue(value: bigint): bigint {
  return value < 0n ? -value : value;
}
