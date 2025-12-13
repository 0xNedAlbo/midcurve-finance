/**
 * Strategy Position Metrics Service
 *
 * Computes metrics for individual strategy positions by aggregating
 * ledger events and calculating unrealized values from position state.
 */

import { PrismaClient } from '@midcurve/database';
import type {
  StrategyPositionMetrics,
  StrategyPositionType,
  AnyToken,
  StrategyPositionInterface,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import {
  StrategyLedgerService,
  type FinancialTotalsResult,
} from '../strategy-ledger/strategy-ledger-service.js';

/**
 * Position value calculator interface
 *
 * Implemented by position-type-specific services to calculate
 * unrealized values from position state.
 */
export interface PositionValueCalculator {
  /**
   * Calculate the current market value of a position
   *
   * @param position - The strategy position to calculate value for
   * @param quoteToken - The quote token for value denomination
   * @returns Current value in quote token units
   */
  calculateCurrentValue(
    position: StrategyPositionInterface,
    quoteToken: AnyToken
  ): Promise<bigint>;

  /**
   * Calculate unrealized income for a position
   *
   * For AMM positions: uncollected fees
   * For HODL positions: 0 (no income until realized)
   *
   * @param position - The strategy position to calculate for
   * @param quoteToken - The quote token for value denomination
   * @returns Unrealized income in quote token units
   */
  calculateUnrealizedIncome(
    position: StrategyPositionInterface,
    quoteToken: AnyToken
  ): Promise<bigint>;
}

/**
 * Dependencies for StrategyPositionMetricsService
 */
export interface StrategyPositionMetricsServiceDependencies {
  /**
   * Prisma client for database operations
   */
  prisma?: PrismaClient;

  /**
   * Strategy ledger service for aggregating ledger events
   */
  strategyLedgerService?: StrategyLedgerService;

  /**
   * Position value calculators keyed by position type
   * If not provided, uses default zero-value calculator
   */
  positionValueCalculators?: Map<string, PositionValueCalculator>;
}

/**
 * Default value calculator that returns zeros
 *
 * Used when no specific calculator is registered for a position type.
 * This is safe because:
 * - currentValue: 0 means position has no calculated value yet
 * - unrealizedIncome: 0 is correct for position types without unrealized income
 */
const defaultValueCalculator: PositionValueCalculator = {
  calculateCurrentValue: async () => 0n,
  calculateUnrealizedIncome: async () => 0n,
};

/**
 * Strategy Position Metrics Service
 *
 * Computes StrategyPositionMetrics by:
 * 1. Aggregating ledger events for realized metrics (cost basis, capital gain, income, expenses)
 * 2. Calculating unrealized metrics from position state (current value, unrealized income)
 */
export class StrategyPositionMetricsService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;
  private readonly strategyLedgerService: StrategyLedgerService;
  private readonly positionValueCalculators: Map<string, PositionValueCalculator>;

  /**
   * Creates a new StrategyPositionMetricsService instance
   */
  constructor(dependencies: StrategyPositionMetricsServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyPositionMetricsService');
    this.strategyLedgerService =
      dependencies.strategyLedgerService ??
      new StrategyLedgerService({ prisma: this.prisma });
    this.positionValueCalculators =
      dependencies.positionValueCalculators ?? new Map();
  }

  /**
   * Register a value calculator for a position type
   *
   * @param positionType - Position type (e.g., 'hodl', 'uniswapv3')
   * @param calculator - Calculator implementation
   */
  registerValueCalculator(
    positionType: string,
    calculator: PositionValueCalculator
  ): void {
    this.positionValueCalculators.set(positionType, calculator);
  }

  /**
   * Compute metrics for a strategy position
   *
   * @param position - The strategy position to compute metrics for
   * @param quoteToken - The quote token (from parent strategy)
   * @returns Computed StrategyPositionMetrics
   */
  async getMetrics(
    position: StrategyPositionInterface,
    quoteToken: AnyToken
  ): Promise<StrategyPositionMetrics> {
    log.methodEntry(this.logger, 'getMetrics', {
      positionId: position.id,
      positionType: position.positionType,
    });

    try {
      // Get realized metrics from ledger events
      const ledgerTotals: FinancialTotalsResult =
        await this.strategyLedgerService.getPositionTotals(position.id);

      // Get value calculator for this position type
      const calculator =
        this.positionValueCalculators.get(position.positionType) ??
        defaultValueCalculator;

      // Calculate unrealized metrics from position state
      const currentValue = await calculator.calculateCurrentValue(
        position,
        quoteToken
      );
      const unrealizedIncome = await calculator.calculateUnrealizedIncome(
        position,
        quoteToken
      );

      const metrics: StrategyPositionMetrics = {
        quoteToken,
        currentCostBasis: ledgerTotals.totalCostBasis,
        currentValue,
        realizedCapitalGain: ledgerTotals.totalRealizedCapitalGain,
        unrealizedIncome,
        realizedIncome: ledgerTotals.totalRealizedIncome,
        expenses: ledgerTotals.totalExpenses,
      };

      log.methodExit(this.logger, 'getMetrics', {
        positionId: position.id,
        currentCostBasis: metrics.currentCostBasis.toString(),
        currentValue: metrics.currentValue.toString(),
      });

      return metrics;
    } catch (error) {
      log.methodError(this.logger, 'getMetrics', error as Error, {
        positionId: position.id,
      });
      throw error;
    }
  }

  /**
   * Compute metrics for a position by ID
   *
   * Fetches the position and quote token from database, then computes metrics.
   *
   * @param positionId - Strategy position ID
   * @returns Computed StrategyPositionMetrics
   * @throws Error if position not found or strategy has no quote token
   */
  async getMetricsById(positionId: string): Promise<StrategyPositionMetrics> {
    log.methodEntry(this.logger, 'getMetricsById', { positionId });

    try {
      // Fetch position with strategy and quote token
      const positionRow = await this.prisma.strategyPosition.findUnique({
        where: { id: positionId },
        include: {
          strategy: {
            include: {
              quoteToken: true,
            },
          },
        },
      });

      if (!positionRow) {
        throw new Error(`Strategy position not found: ${positionId}`);
      }

      if (!positionRow.strategy.quoteToken) {
        throw new Error(
          `Strategy ${positionRow.strategy.id} has no quote token`
        );
      }

      // Convert row to interface (simplified - real implementation would use factory)
      const position: StrategyPositionInterface = {
        id: positionRow.id,
        strategyId: positionRow.strategyId,
        positionType: positionRow.positionType as StrategyPositionType,
        status: positionRow.status as 'pending' | 'active' | 'paused' | 'closed',
        openedAt: positionRow.openedAt,
        closedAt: positionRow.closedAt,
        config: positionRow.config as Record<string, unknown>,
        state: positionRow.state as Record<string, unknown>,
        createdAt: positionRow.createdAt,
        updatedAt: positionRow.updatedAt,
        toJSON: () => ({
          id: positionRow.id,
          strategyId: positionRow.strategyId,
          positionType: positionRow.positionType as StrategyPositionType,
          status: positionRow.status as 'pending' | 'active' | 'paused' | 'closed',
          openedAt: positionRow.openedAt?.toISOString() ?? null,
          closedAt: positionRow.closedAt?.toISOString() ?? null,
          config: positionRow.config as Record<string, unknown>,
          state: positionRow.state as Record<string, unknown>,
          createdAt: positionRow.createdAt.toISOString(),
          updatedAt: positionRow.updatedAt.toISOString(),
        }),
        getDisplayName: () => `Position ${positionRow.id}`,
      };

      // TODO: Convert token row to AnyToken (using TokenService)
      // For now, use a simplified conversion
      const quoteToken = positionRow.strategy.quoteToken as unknown as AnyToken;

      return this.getMetrics(position, quoteToken);
    } catch (error) {
      log.methodError(this.logger, 'getMetricsById', error as Error, {
        positionId,
      });
      throw error;
    }
  }
}
