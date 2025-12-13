/**
 * Strategy Ledger Service
 *
 * Provides CRUD operations and aggregation for strategy ledger events.
 * Handles the financial event tracking for strategy positions.
 */

import { PrismaClient, Prisma } from '@midcurve/database';
import type {
  StrategyLedgerEvent,
  StrategyLedgerEventType,
  StrategyLedgerEventRow,
} from '@midcurve/shared';
import { strategyLedgerEventFromRow } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for StrategyLedgerService
 */
export interface StrategyLedgerServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Input for creating a new strategy ledger event
 */
export interface CreateStrategyLedgerEventInput {
  /**
   * Parent strategy ID
   */
  strategyId: string;

  /**
   * Parent strategy position ID
   */
  strategyPositionId: string;

  /**
   * Group ID for atomic transactions (UUID)
   * Events in the same group are part of a single logical transaction.
   */
  groupId: string;

  /**
   * When the event occurred
   */
  timestamp: Date;

  /**
   * Order within the same timestamp (defaults to 0)
   */
  sequenceNumber?: number;

  /**
   * Type of financial event
   */
  eventType: StrategyLedgerEventType;

  /**
   * Token database ID
   */
  tokenId: string;

  /**
   * Token hash for readability/logging
   * Format: "erc20:chainId:address"
   */
  tokenHash: string;

  /**
   * Token amount in smallest units
   * Positive for inflows, negative for outflows
   */
  amount: bigint;

  /**
   * Value in strategy's quote token
   */
  valueInQuote: bigint;

  /**
   * Change in cost basis from this event
   */
  deltaCostBasis: bigint;

  /**
   * Change in realized capital gain from this event
   */
  deltaRealizedCapitalGain: bigint;

  /**
   * Change in realized income from this event
   */
  deltaRealizedIncome: bigint;

  /**
   * Change in expenses from this event
   */
  deltaExpense: bigint;

  /**
   * Immutable event metadata (JSON)
   */
  config?: Record<string, unknown>;

  /**
   * Event-specific state (JSON)
   */
  state?: Record<string, unknown>;
}

/**
 * Options for finding strategy ledger events
 */
export interface FindStrategyLedgerEventsOptions {
  /**
   * Filter by strategy ID
   */
  strategyId?: string;

  /**
   * Filter by strategy position ID
   */
  strategyPositionId?: string;

  /**
   * Filter by group ID
   */
  groupId?: string;

  /**
   * Filter by event type(s)
   */
  eventType?: StrategyLedgerEventType | StrategyLedgerEventType[];

  /**
   * Filter by token ID
   */
  tokenId?: string;

  /**
   * Filter events after this timestamp
   */
  fromTimestamp?: Date;

  /**
   * Filter events before this timestamp
   */
  toTimestamp?: Date;

  /**
   * Limit number of results
   */
  limit?: number;

  /**
   * Order direction (default: 'asc')
   */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Aggregation result for cost basis by token
 */
export interface TokenCostBasisResult {
  tokenId: string;
  costBasis: bigint;
}

/**
 * Aggregation result for totals
 *
 * These totals align with the delta fields on StrategyLedgerEvent and
 * aggregate up to StrategyMetrics/StrategyPositionMetrics.
 */
export interface FinancialTotalsResult {
  /**
   * Sum of deltaCostBasis (aggregates to currentCostBasis)
   */
  totalCostBasis: bigint;

  /**
   * Sum of deltaRealizedCapitalGain (aggregates to realizedCapitalGain)
   */
  totalRealizedCapitalGain: bigint;

  /**
   * Sum of deltaRealizedIncome (aggregates to realizedIncome)
   */
  totalRealizedIncome: bigint;

  /**
   * Sum of deltaExpense (aggregates to expenses)
   */
  totalExpenses: bigint;
}

/**
 * Strategy Ledger Service
 *
 * Handles all strategy ledger event database operations including:
 * - CRUD operations
 * - Event grouping
 * - Financial aggregation (cost basis, income, expenses)
 */
export class StrategyLedgerService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new StrategyLedgerService instance
   */
  constructor(dependencies: StrategyLedgerServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyLedgerService');
  }

  /**
   * Create a new strategy ledger event
   */
  async create(input: CreateStrategyLedgerEventInput): Promise<StrategyLedgerEvent> {
    log.methodEntry(this.logger, 'create', { input: { ...input, amount: input.amount.toString() } });

    try {
      const result = await this.prisma.strategyLedgerEvent.create({
        data: {
          strategyId: input.strategyId,
          strategyPositionId: input.strategyPositionId,
          groupId: input.groupId,
          timestamp: input.timestamp,
          sequenceNumber: input.sequenceNumber ?? 0,
          eventType: input.eventType,
          tokenId: input.tokenId,
          tokenHash: input.tokenHash,
          amount: input.amount.toString(),
          valueInQuote: input.valueInQuote.toString(),
          deltaCostBasis: input.deltaCostBasis.toString(),
          deltaRealizedCapitalGain: input.deltaRealizedCapitalGain.toString(),
          deltaRealizedIncome: input.deltaRealizedIncome.toString(),
          deltaExpense: input.deltaExpense.toString(),
          config: (input.config ?? {}) as Prisma.InputJsonValue,
          state: (input.state ?? {}) as Prisma.InputJsonValue,
        },
      });

      const event = strategyLedgerEventFromRow(
        result as unknown as StrategyLedgerEventRow
      );

      log.methodExit(this.logger, 'create', { id: event.id });
      return event;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Create multiple strategy ledger events atomically
   *
   * Use this for creating events in the same group.
   */
  async createMany(inputs: CreateStrategyLedgerEventInput[]): Promise<StrategyLedgerEvent[]> {
    log.methodEntry(this.logger, 'createMany', { count: inputs.length });

    try {
      // Use a transaction to ensure atomicity
      const results = await this.prisma.$transaction(
        inputs.map((input) =>
          this.prisma.strategyLedgerEvent.create({
            data: {
              strategyId: input.strategyId,
              strategyPositionId: input.strategyPositionId,
              groupId: input.groupId,
              timestamp: input.timestamp,
              sequenceNumber: input.sequenceNumber ?? 0,
              eventType: input.eventType,
              tokenId: input.tokenId,
              tokenHash: input.tokenHash,
              amount: input.amount.toString(),
              valueInQuote: input.valueInQuote.toString(),
              deltaCostBasis: input.deltaCostBasis.toString(),
              deltaRealizedCapitalGain: input.deltaRealizedCapitalGain.toString(),
              deltaRealizedIncome: input.deltaRealizedIncome.toString(),
              deltaExpense: input.deltaExpense.toString(),
              config: (input.config ?? {}) as Prisma.InputJsonValue,
              state: (input.state ?? {}) as Prisma.InputJsonValue,
            },
          })
        )
      );

      const events = results.map((result) =>
        strategyLedgerEventFromRow(result as unknown as StrategyLedgerEventRow)
      );

      log.methodExit(this.logger, 'createMany', { count: events.length });
      return events;
    } catch (error) {
      log.methodError(this.logger, 'createMany', error as Error, { count: inputs.length });
      throw error;
    }
  }

  /**
   * Find a strategy ledger event by ID
   */
  async findById(id: string): Promise<StrategyLedgerEvent | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const result = await this.prisma.strategyLedgerEvent.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { found: false });
        return null;
      }

      const event = strategyLedgerEventFromRow(
        result as unknown as StrategyLedgerEventRow
      );

      log.methodExit(this.logger, 'findById', { found: true });
      return event;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find strategy ledger events with filters
   */
  async find(options: FindStrategyLedgerEventsOptions = {}): Promise<StrategyLedgerEvent[]> {
    log.methodEntry(this.logger, 'find', { options });

    try {
      const where: Record<string, unknown> = {};

      if (options.strategyId) {
        where.strategyId = options.strategyId;
      }

      if (options.strategyPositionId) {
        where.strategyPositionId = options.strategyPositionId;
      }

      if (options.groupId) {
        where.groupId = options.groupId;
      }

      if (options.eventType) {
        if (Array.isArray(options.eventType)) {
          where.eventType = { in: options.eventType };
        } else {
          where.eventType = options.eventType;
        }
      }

      if (options.tokenId) {
        where.tokenId = options.tokenId;
      }

      if (options.fromTimestamp || options.toTimestamp) {
        where.timestamp = {};
        if (options.fromTimestamp) {
          (where.timestamp as Record<string, Date>).gte = options.fromTimestamp;
        }
        if (options.toTimestamp) {
          (where.timestamp as Record<string, Date>).lte = options.toTimestamp;
        }
      }

      const results = await this.prisma.strategyLedgerEvent.findMany({
        where,
        orderBy: [
          { timestamp: options.orderDirection ?? 'asc' },
          { sequenceNumber: options.orderDirection ?? 'asc' },
        ],
        take: options.limit,
      });

      const events = results.map((result) =>
        strategyLedgerEventFromRow(result as unknown as StrategyLedgerEventRow)
      );

      log.methodExit(this.logger, 'find', { count: events.length });
      return events;
    } catch (error) {
      log.methodError(this.logger, 'find', error as Error, { options });
      throw error;
    }
  }

  /**
   * Find all events for a strategy position
   */
  async findByPositionId(strategyPositionId: string): Promise<StrategyLedgerEvent[]> {
    return this.find({ strategyPositionId });
  }

  /**
   * Find all events in a group
   */
  async findByGroupId(groupId: string): Promise<StrategyLedgerEvent[]> {
    return this.find({ groupId });
  }

  /**
   * Delete a strategy ledger event
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      await this.prisma.strategyLedgerEvent.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete all events in a group atomically
   *
   * Use this to remove a complete transaction (e.g., when reverting).
   */
  async deleteByGroupId(groupId: string): Promise<number> {
    log.methodEntry(this.logger, 'deleteByGroupId', { groupId });

    try {
      const result = await this.prisma.strategyLedgerEvent.deleteMany({
        where: { groupId },
      });

      log.methodExit(this.logger, 'deleteByGroupId', { count: result.count });
      return result.count;
    } catch (error) {
      log.methodError(this.logger, 'deleteByGroupId', error as Error, { groupId });
      throw error;
    }
  }

  // ============================================================================
  // Aggregation Methods
  // ============================================================================

  /**
   * Get cost basis by token for a strategy position
   *
   * Returns the aggregated cost basis for each token in the position.
   *
   * Note: Since bigint fields are stored as strings, we aggregate in JavaScript.
   * For high-volume use cases, consider raw SQL with CAST.
   */
  async getCostBasisByToken(strategyPositionId: string): Promise<TokenCostBasisResult[]> {
    log.methodEntry(this.logger, 'getCostBasisByToken', { strategyPositionId });

    try {
      // Fetch all events for the position
      const events = await this.prisma.strategyLedgerEvent.findMany({
        where: { strategyPositionId },
        select: {
          tokenId: true,
          deltaCostBasis: true,
        },
      });

      // Aggregate in JavaScript
      const costBasisMap = new Map<string, bigint>();
      for (const event of events) {
        const existing = costBasisMap.get(event.tokenId) ?? 0n;
        costBasisMap.set(event.tokenId, existing + BigInt(event.deltaCostBasis));
      }

      const costBases = Array.from(costBasisMap.entries()).map(([tokenId, costBasis]) => ({
        tokenId,
        costBasis,
      }));

      log.methodExit(this.logger, 'getCostBasisByToken', { count: costBases.length });
      return costBases;
    } catch (error) {
      log.methodError(this.logger, 'getCostBasisByToken', error as Error, { strategyPositionId });
      throw error;
    }
  }

  /**
   * Get financial totals for a strategy position
   *
   * Returns aggregated totals that align with StrategyPositionMetrics fields.
   *
   * Note: Since bigint fields are stored as strings, we aggregate in JavaScript.
   * For high-volume use cases, consider raw SQL with CAST.
   */
  async getPositionTotals(strategyPositionId: string): Promise<FinancialTotalsResult> {
    log.methodEntry(this.logger, 'getPositionTotals', { strategyPositionId });

    try {
      // Fetch all events for the position
      const events = await this.prisma.strategyLedgerEvent.findMany({
        where: { strategyPositionId },
        select: {
          deltaCostBasis: true,
          deltaRealizedCapitalGain: true,
          deltaRealizedIncome: true,
          deltaExpense: true,
        },
      });

      // Aggregate in JavaScript
      let totalCostBasis = 0n;
      let totalRealizedCapitalGain = 0n;
      let totalRealizedIncome = 0n;
      let totalExpenses = 0n;

      for (const event of events) {
        totalCostBasis += BigInt(event.deltaCostBasis);
        totalRealizedCapitalGain += BigInt(event.deltaRealizedCapitalGain);
        totalRealizedIncome += BigInt(event.deltaRealizedIncome);
        totalExpenses += BigInt(event.deltaExpense);
      }

      const totals: FinancialTotalsResult = {
        totalCostBasis,
        totalRealizedCapitalGain,
        totalRealizedIncome,
        totalExpenses,
      };

      log.methodExit(this.logger, 'getPositionTotals', {
        totalCostBasis: totals.totalCostBasis.toString(),
        totalRealizedCapitalGain: totals.totalRealizedCapitalGain.toString(),
        totalRealizedIncome: totals.totalRealizedIncome.toString(),
        totalExpenses: totals.totalExpenses.toString(),
      });
      return totals;
    } catch (error) {
      log.methodError(this.logger, 'getPositionTotals', error as Error, { strategyPositionId });
      throw error;
    }
  }

  /**
   * Get financial totals for a strategy
   *
   * Returns aggregated totals that align with StrategyMetrics fields.
   *
   * Note: Since bigint fields are stored as strings, we aggregate in JavaScript.
   * For high-volume use cases, consider raw SQL with CAST.
   */
  async getStrategyTotals(strategyId: string): Promise<FinancialTotalsResult> {
    log.methodEntry(this.logger, 'getStrategyTotals', { strategyId });

    try {
      // Fetch all events for the strategy
      const events = await this.prisma.strategyLedgerEvent.findMany({
        where: { strategyId },
        select: {
          deltaCostBasis: true,
          deltaRealizedCapitalGain: true,
          deltaRealizedIncome: true,
          deltaExpense: true,
        },
      });

      // Aggregate in JavaScript
      let totalCostBasis = 0n;
      let totalRealizedCapitalGain = 0n;
      let totalRealizedIncome = 0n;
      let totalExpenses = 0n;

      for (const event of events) {
        totalCostBasis += BigInt(event.deltaCostBasis);
        totalRealizedCapitalGain += BigInt(event.deltaRealizedCapitalGain);
        totalRealizedIncome += BigInt(event.deltaRealizedIncome);
        totalExpenses += BigInt(event.deltaExpense);
      }

      const totals: FinancialTotalsResult = {
        totalCostBasis,
        totalRealizedCapitalGain,
        totalRealizedIncome,
        totalExpenses,
      };

      log.methodExit(this.logger, 'getStrategyTotals', {
        totalCostBasis: totals.totalCostBasis.toString(),
        totalRealizedCapitalGain: totals.totalRealizedCapitalGain.toString(),
        totalRealizedIncome: totals.totalRealizedIncome.toString(),
        totalExpenses: totals.totalExpenses.toString(),
      });
      return totals;
    } catch (error) {
      log.methodError(this.logger, 'getStrategyTotals', error as Error, { strategyId });
      throw error;
    }
  }

  /**
   * Calculate realized PnL for a strategy position
   *
   * Realized PnL = realizedCapitalGain + realizedIncome - expenses
   */
  async getPositionRealizedPnL(strategyPositionId: string): Promise<bigint> {
    const totals = await this.getPositionTotals(strategyPositionId);
    return (
      totals.totalRealizedCapitalGain +
      totals.totalRealizedIncome -
      totals.totalExpenses
    );
  }

  /**
   * Calculate realized PnL for a strategy
   *
   * Realized PnL = realizedCapitalGain + realizedIncome - expenses
   */
  async getStrategyRealizedPnL(strategyId: string): Promise<bigint> {
    const totals = await this.getStrategyTotals(strategyId);
    return (
      totals.totalRealizedCapitalGain +
      totals.totalRealizedIncome -
      totals.totalExpenses
    );
  }

  /**
   * @deprecated Use getPositionRealizedPnL instead
   */
  async getPositionNetPnL(strategyPositionId: string): Promise<bigint> {
    return this.getPositionRealizedPnL(strategyPositionId);
  }

  /**
   * @deprecated Use getStrategyRealizedPnL instead
   */
  async getStrategyNetPnL(strategyId: string): Promise<bigint> {
    return this.getStrategyRealizedPnL(strategyId);
  }
}
