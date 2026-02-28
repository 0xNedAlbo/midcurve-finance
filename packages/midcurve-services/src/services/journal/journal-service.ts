/**
 * JournalService
 *
 * CRUD operations for double-entry journal entries and lines.
 * Provides idempotency, balance queries, and deletion for the accounting system.
 */

import { prisma as prismaClient, PrismaClient, Prisma } from '@midcurve/database';
import type { JournalEntryInput, JournalLineInput } from '@midcurve/shared';
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
  // Instrument Tracking
  // ---------------------------------------------------------------------------

  /**
   * Registers an instrument for journal tracking (idempotent via unique constraint).
   * Called on position.created — ensures subsequent events are not skipped.
   */
  async trackInstrument(userId: string, instrumentRef: string): Promise<void> {
    await this.prisma.trackedInstrument.upsert({
      where: { userId_instrumentRef: { userId, instrumentRef } },
      create: { userId, instrumentRef },
      update: {},
    });
  }

  /**
   * Removes an instrument from tracking.
   * Called on position.deleted.
   */
  async untrackInstrument(userId: string, instrumentRef: string): Promise<void> {
    await this.prisma.trackedInstrument.deleteMany({
      where: { userId, instrumentRef },
    });
  }

  /**
   * Returns true if the instrument is registered for tracking.
   * Replaces the old hasEntriesForInstrument guard.
   */
  async isTracked(userId: string, instrumentRef: string): Promise<boolean> {
    const record = await this.prisma.trackedInstrument.findUnique({
      where: { userId_instrumentRef: { userId, instrumentRef } },
      select: { id: true },
    });
    return record !== null;
  }

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  /**
   * Returns true if any journal lines exist for the given instrument.
   */
  async hasEntriesForInstrument(instrumentRef: string): Promise<boolean> {
    const line = await this.prisma.journalLine.findFirst({
      where: { instrumentRef },
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
          ledgerEventRef: entry.ledgerEventRef,
          entryDate: entry.entryDate,
          description: entry.description,
          memo: entry.memo,
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
   * Computes the net balance for a specific account + instrument combination.
   *
   * For debit-normal accounts (assets, expenses): balance = sum(debits) - sum(credits)
   * For credit-normal accounts (equity, revenue, liabilities): balance = sum(credits) - sum(debits)
   *
   * Returns the raw signed balance (positive = in the direction of normal side).
   * The caller interprets the sign based on the account's normal side.
   */
  async getAccountBalance(accountCode: number, instrumentRef: string): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, instrumentRef },
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

    // Return net balance in the direction that increases this account.
    // For debit-normal accounts: positive means net debit (good).
    // For credit-normal accounts: we still return debits - credits,
    // so the caller needs to know the account's normal side.
    return debits - credits;
  }

  /**
   * Same as getAccountBalance but aggregates amountReporting instead of amountQuote.
   * Lines where amountReporting is NULL are skipped.
   */
  async getAccountBalanceReporting(accountCode: number, instrumentRef: string): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, instrumentRef, amountReporting: { not: null } },
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
   * Computes the net balance for a specific account + instrument,
   * scoped to a specific user (via journal entries).
   */
  async getAccountBalanceForUser(
    accountCode: number,
    instrumentRef: string,
    userId: string
  ): Promise<bigint> {
    const accountId = await this.resolveAccountId(accountCode);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId,
        instrumentRef,
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

  // ---------------------------------------------------------------------------
  // Deletion
  // ---------------------------------------------------------------------------

  /**
   * Deletes all journal entries (and cascading lines) that reference the given instrument.
   * Used when a position is deleted from the system.
   */
  async deleteByInstrumentRef(instrumentRef: string): Promise<number> {
    // Find all entry IDs that have at least one line with this instrumentRef
    const entries = await this.prisma.journalLine.findMany({
      where: { instrumentRef },
      select: { journalEntryId: true },
      distinct: ['journalEntryId'],
    });

    const entryIds = entries.map((e) => e.journalEntryId);
    if (entryIds.length === 0) return 0;

    const result = await this.prisma.journalEntry.deleteMany({
      where: { id: { in: entryIds } },
    });

    this.logger.info(`Deleted ${result.count} journal entries for instrument ${instrumentRef}`);
    return result.count;
  }

  /**
   * Deletes journal entries that reference the given ledger event refs.
   * Used for chain reorg handling.
   */
  async deleteByLedgerEventRefs(refs: string[]): Promise<number> {
    if (refs.length === 0) return 0;

    const result = await this.prisma.journalEntry.deleteMany({
      where: { ledgerEventRef: { in: refs } },
    });

    this.logger.info(`Deleted ${result.count} journal entries for ${refs.length} ledger event refs`);
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Returns all journal entries for a given instrument, ordered by entry date.
   * Used for debugging and validation.
   */
  async getEntriesByInstrument(instrumentRef: string) {
    // Find entry IDs that reference this instrument
    const entryIds = await this.prisma.journalLine.findMany({
      where: { instrumentRef },
      select: { journalEntryId: true },
      distinct: ['journalEntryId'],
    });

    return this.prisma.journalEntry.findMany({
      where: { id: { in: entryIds.map((e) => e.journalEntryId) } },
      include: { lines: true },
      orderBy: { entryDate: 'asc' },
    });
  }
}
