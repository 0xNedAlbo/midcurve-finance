/**
 * JournalService
 *
 * CRUD operations for double-entry journal entries and lines.
 * Provides idempotency, balance queries, and deletion for the accounting system.
 */

import { prisma as prismaClient, PrismaClient, Prisma } from '@midcurve/database';
import type { JournalEntryInput, JournalLineInput } from '@midcurve/shared';
import { ACCOUNT_CODES, CHART_OF_ACCOUNTS } from '@midcurve/shared';
import type {
  JournalEntryData,
  JournalLineData,
  PositionAccountingResponse,
} from '@midcurve/api-shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface JournalServiceDependencies {
  prisma?: PrismaClient;
}

export class JournalService {
  private static instance: JournalService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /** Cached map of account code → account ID (CUID). Loaded once on first use. */
  private accountCodeToId: Map<number, string> | null = null;

  constructor(deps?: JournalServiceDependencies) {
    this.prisma = (deps?.prisma ?? prismaClient) as PrismaClient;
    this.logger = createServiceLogger('JournalService');
  }

  static getInstance(deps?: JournalServiceDependencies): JournalService {
    if (!JournalService.instance) {
      JournalService.instance = new JournalService(deps);
    }
    return JournalService.instance;
  }

  // ---------------------------------------------------------------------------
  // Chart of Accounts Seeding
  // ---------------------------------------------------------------------------

  /**
   * Upserts all accounts from CHART_OF_ACCOUNTS into the database.
   * Idempotent — safe to call on every startup.
   * Invalidates the cached account code map afterward.
   */
  async ensureChartOfAccounts(): Promise<number> {
    for (const account of CHART_OF_ACCOUNTS) {
      await this.prisma.accountDefinition.upsert({
        where: { code: account.code },
        update: {
          name: account.name,
          description: account.description,
          category: account.category,
          normalSide: account.normalSide,
        },
        create: {
          code: account.code,
          name: account.name,
          description: account.description,
          category: account.category,
          normalSide: account.normalSide,
        },
      });
    }

    // Invalidate cached map so it picks up any new accounts
    this.accountCodeToId = null;

    this.logger.info(`Ensured ${CHART_OF_ACCOUNTS.length} account definitions`);
    return CHART_OF_ACCOUNTS.length;
  }

  // ---------------------------------------------------------------------------
  // Account Code → ID resolution
  // ---------------------------------------------------------------------------

  /**
   * Loads the AccountDefinition table into an in-memory map.
   * Called once on first use and cached for the service lifetime.
   */
  private async getAccountCodeMap(): Promise<Map<number, string>> {
    if (this.accountCodeToId) return this.accountCodeToId;

    const accounts = await this.prisma.accountDefinition.findMany({
      select: { id: true, code: true },
    });

    this.accountCodeToId = new Map(accounts.map((a) => [a.code, a.id]));
    return this.accountCodeToId;
  }

  private async resolveAccountId(code: number): Promise<string> {
    const map = await this.getAccountCodeMap();
    const id = map.get(code);
    if (!id) {
      throw new Error(`JournalService: unknown account code ${code}`);
    }
    return id;
  }

  // ---------------------------------------------------------------------------
  // Position Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Deletes all journal entries (and their lines via cascade) for a position.
   * Used when a position is deleted from the system.
   */
  async deleteEntriesByPositionRef(positionRef: string): Promise<number> {
    // Find journal entry IDs that have lines referencing this position
    const entries = await this.prisma.journalEntry.findMany({
      where: { lines: { some: { positionRef } } },
      select: { id: true },
    });
    if (entries.length === 0) return 0;

    const result = await this.prisma.journalEntry.deleteMany({
      where: { id: { in: entries.map((e) => e.id) } },
    });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  /**
   * Returns true if any journal lines exist for the given position.
   */
  async hasEntriesForPosition(positionRef: string): Promise<boolean> {
    const line = await this.prisma.journalLine.findFirst({
      where: { positionRef },
      select: { id: true },
    });
    return line !== null;
  }

  /**
   * Returns true if a journal entry with the given domainEventId already exists.
   */
  async isProcessed(domainEventId: string): Promise<boolean> {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { domainEventId },
      select: { id: true },
    });
    return existing !== null;
  }

  // ---------------------------------------------------------------------------
  // Create Entry
  // ---------------------------------------------------------------------------

  /**
   * Creates a journal entry with its lines in a single transaction.
   * Lines are validated for balance (sum debits = sum credits) before persistence.
   *
   * @param entry - Entry metadata (userId, dates, traceability)
   * @param lines - Balanced debit/credit lines (use JournalLineBuilder)
   * @param tx - Optional Prisma transaction client for composing with outer transactions
   */
  async createEntry(
    entry: JournalEntryInput,
    lines: JournalLineInput[],
    tx?: Prisma.TransactionClient
  ): Promise<string> {
    // Resolve account codes to IDs
    const resolvedLines = await Promise.all(
      lines.map(async (line) => ({
        accountId: await this.resolveAccountId(line.accountCode),
        positionRef: line.positionRef,
        instrumentRef: line.instrumentRef,
        side: line.side,
        amountQuote: line.amountQuote,
        amountReporting: line.amountReporting,
        reportingCurrency: line.reportingCurrency,
        exchangeRate: line.exchangeRate,
      }))
    );

    const createFn = async (client: Prisma.TransactionClient | PrismaClient) => {
      const created = await client.journalEntry.create({
        data: {
          userId: entry.userId,
          domainEventId: entry.domainEventId,
          domainEventType: entry.domainEventType,
          positionLedgerEventId: entry.positionLedgerEventId,
          entryDate: entry.entryDate,
          description: entry.description,
          memo: entry.memo,
          tokenLotId: entry.tokenLotId,
          tokenLotDisposalId: entry.tokenLotDisposalId,
          lines: {
            create: resolvedLines,
          },
        },
        select: { id: true },
      });
      return created.id;
    };

    if (tx) {
      return createFn(tx);
    }

    return this.prisma.$transaction(async (txClient) => createFn(txClient));
  }

  // ---------------------------------------------------------------------------
  // Balance Queries
  // ---------------------------------------------------------------------------

  /**
   * Computes the net balance for a specific account + position combination.
   *
   * For debit-normal accounts (assets, expenses): balance = sum(debits) - sum(credits)
   * For credit-normal accounts (equity, revenue, liabilities): balance = sum(credits) - sum(debits)
   *
   * Returns the raw signed balance (positive = in the direction of normal side).
   * The caller interprets the sign based on the account's normal side.
   */
  async getAccountBalance(accountCode: number, positionRef: string): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, positionRef },
      select: { side: true, amountQuote: true },
    });

    let debits = 0n;
    let credits = 0n;

    for (const line of lines) {
      const amount = BigInt(line.amountQuote);
      if (line.side === 'debit') {
        debits += amount;
      } else {
        credits += amount;
      }
    }

    return debits - credits;
  }

  /**
   * Same as getAccountBalance but aggregates amountReporting instead of amountQuote.
   * Lines where amountReporting is NULL are skipped.
   */
  async getAccountBalanceReporting(accountCode: number, positionRef: string): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, positionRef, amountReporting: { not: null } },
      select: { side: true, amountReporting: true },
    });

    let debits = 0n;
    let credits = 0n;

    for (const line of lines) {
      const amount = BigInt(line.amountReporting!);
      if (line.side === 'debit') {
        debits += amount;
      } else {
        credits += amount;
      }
    }

    return debits - credits;
  }

  /**
   * Computes the weighted average exchange rate for debit-side entries
   * on a given account + position. Used to determine the historical average
   * rate at which cost basis was recorded.
   *
   * WAC rate = sum(amountReporting) / sum(amountQuote) * 10^quoteTokenDecimals
   *
   * Returns null if there are no debit-side entries with reporting amounts.
   */
  async getAccountWacExchangeRate(
    accountCode: number,
    positionRef: string,
    quoteTokenDecimals: number
  ): Promise<bigint | null> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, positionRef, side: 'debit', amountReporting: { not: null } },
      select: { amountQuote: true, amountReporting: true },
    });

    let totalQuote = 0n;
    let totalReporting = 0n;

    for (const line of lines) {
      totalQuote += BigInt(line.amountQuote);
      totalReporting += BigInt(line.amountReporting!);
    }

    if (totalQuote === 0n) return null;

    // WAC rate at the same scale as exchangeRate (10^8), derived from the totals
    // amountReporting = amountQuote * exchangeRate / 10^quoteTokenDecimals
    // => exchangeRate = amountReporting * 10^quoteTokenDecimals / amountQuote
    return (totalReporting * 10n ** BigInt(quoteTokenDecimals)) / totalQuote;
  }

  /**
   * Computes the net balance for a specific account + position,
   * scoped to a specific user (via journal entries).
   */
  async getAccountBalanceForUser(
    accountCode: number,
    positionRef: string,
    userId: string
  ): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId,
        positionRef,
        journalEntry: { userId },
      },
      select: { side: true, amountQuote: true },
    });

    let debits = 0n;
    let credits = 0n;

    for (const line of lines) {
      const amount = BigInt(line.amountQuote);
      if (line.side === 'debit') {
        debits += amount;
      } else {
        credits += amount;
      }
    }

    return debits - credits;
  }

  /**
   * Computes the net reporting-currency balance for a specific account across
   * all positions belonging to a user. Used by the balance sheet endpoint.
   */
  async getUserAccountBalanceReporting(
    accountCode: number,
    userId: string,
    asOf: Date,
  ): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId,
        amountReporting: { not: null },
        journalEntry: { userId, entryDate: { lte: asOf } },
      },
      select: { side: true, amountReporting: true },
    });

    let debits = 0n;
    let credits = 0n;

    for (const line of lines) {
      const amount = BigInt(line.amountReporting!);
      if (line.side === 'debit') {
        debits += amount;
      } else {
        credits += amount;
      }
    }

    return debits - credits;
  }

  // ---------------------------------------------------------------------------
  // Deletion
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Ledger event FK cascade handles cleanup automatically.
   * Kept for backward compatibility — will be removed in a future cleanup.
   */
  async deleteByLedgerEventRefs(_refs: string[]): Promise<number> {
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Returns all journal entries for a given position, ordered by entry date.
   * Used for debugging and validation.
   */
  async getEntriesByPosition(positionRef: string) {
    // Find entry IDs that reference this position
    const entryIds = await this.prisma.journalLine.findMany({
      where: { positionRef },
      select: { journalEntryId: true },
      distinct: ['journalEntryId'],
    });

    return this.prisma.journalEntry.findMany({
      where: { id: { in: entryIds.map((e) => e.journalEntryId) } },
      include: { lines: true },
      orderBy: { entryDate: 'asc' },
    });
  }

  /**
   * Builds a per-position accounting report: lifetime-to-date balance sheet,
   * realized-only P&L, and the full journal entry audit trail.
   *
   * Balance-sheet sign conventions mirror the portfolio balance sheet route:
   * assets use raw signed balance (debit-positive); equity items are negated
   * for display. P&L sign conventions mirror the portfolio pnl route.
   *
   * Lines with `amountReporting = null` are skipped in aggregation but still
   * listed in the journal entries array (their amount shows as null in the UI).
   */
  async getPositionAccountingReport(
    positionRef: string,
    userId: string
  ): Promise<PositionAccountingResponse> {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        lines: { some: { positionRef } },
      },
      include: {
        lines: {
          include: {
            account: {
              select: { code: true, name: true, category: true },
            },
          },
        },
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
    });

    let lpPositionAtCost = 0n;
    let contributedCapital = 0n;
    let capitalReturned = 0n;
    let realizedGains = 0n;
    let realizedLosses = 0n;
    let feeIncome = 0n;
    let fxGainLoss = 0n;

    let reportingCurrency = 'USD';

    const journalEntries: JournalEntryData[] = [];

    for (const entry of entries) {
      const linesForThisPosition = entry.lines.filter((l) => l.positionRef === positionRef);

      const lines: JournalLineData[] = linesForThisPosition.map((line) => ({
        accountCode: line.account.code,
        accountName: line.account.name,
        accountCategory: line.account.category,
        side: line.side as 'debit' | 'credit',
        amountReporting: line.amountReporting,
      }));

      journalEntries.push({
        id: entry.id,
        entryDate: entry.entryDate.toISOString(),
        description: entry.description,
        memo: entry.memo,
        lines,
      });

      for (const line of linesForThisPosition) {
        if (line.amountReporting === null) continue;
        if (line.reportingCurrency) reportingCurrency = line.reportingCurrency;

        const amount = BigInt(line.amountReporting);
        const signed = line.side === 'debit' ? amount : -amount;

        switch (line.account.code) {
          case ACCOUNT_CODES.LP_POSITION_AT_COST:
            lpPositionAtCost += signed;
            break;
          case ACCOUNT_CODES.CONTRIBUTED_CAPITAL:
            contributedCapital += signed;
            break;
          case ACCOUNT_CODES.CAPITAL_RETURNED:
            capitalReturned += signed;
            break;
          case ACCOUNT_CODES.REALIZED_GAINS:
            realizedGains += signed;
            break;
          case ACCOUNT_CODES.REALIZED_LOSSES:
            realizedLosses += signed;
            break;
          case ACCOUNT_CODES.FEE_INCOME:
            feeIncome += signed;
            break;
          case ACCOUNT_CODES.FX_GAIN_LOSS:
            fxGainLoss += signed;
            break;
        }
      }
    }

    // P&L sign conventions (mirror portfolio /accounting/pnl route):
    //   Revenue (credit-normal): negate signed for positive-on-credit
    //   Expense (debit-normal): take signed directly for positive-on-debit
    const realizedFromWithdrawals = -realizedGains - realizedLosses;
    const realizedFromCollectedFees = -feeIncome;
    const realizedFromFxEffect = -fxGainLoss;
    const netPnl = realizedFromWithdrawals + realizedFromCollectedFees + realizedFromFxEffect;

    // Balance-sheet sign conventions (mirror portfolio /accounting/balance-sheet route):
    //   Assets: raw signed (debit-positive)
    //   Equity: negated for display
    const lpPositionAtCostDisplay = lpPositionAtCost;
    const contributedCapitalDisplay = -contributedCapital;
    const capitalReturnedDisplay = -capitalReturned;
    const retainedEarningsTotal = realizedFromWithdrawals + realizedFromCollectedFees + realizedFromFxEffect;
    const totalEquity = contributedCapitalDisplay + capitalReturnedDisplay + retainedEarningsTotal;

    return {
      positionRef,
      reportingCurrency,
      balanceSheet: {
        assets: {
          lpPositionAtCost: lpPositionAtCostDisplay.toString(),
          totalAssets: lpPositionAtCostDisplay.toString(),
        },
        equity: {
          contributedCapital: contributedCapitalDisplay.toString(),
          capitalReturned: capitalReturnedDisplay.toString(),
          retainedEarnings: {
            realizedFromWithdrawals: realizedFromWithdrawals.toString(),
            realizedFromCollectedFees: realizedFromCollectedFees.toString(),
            realizedFromFxEffect: realizedFromFxEffect.toString(),
            total: retainedEarningsTotal.toString(),
          },
          totalEquity: totalEquity.toString(),
        },
      },
      pnl: {
        realizedFromWithdrawals: realizedFromWithdrawals.toString(),
        realizedFromCollectedFees: realizedFromCollectedFees.toString(),
        realizedFromFxEffect: realizedFromFxEffect.toString(),
        netPnl: netPnl.toString(),
      },
      journalEntries,
    };
  }
}
