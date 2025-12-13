/**
 * Strategy Metrics Service
 *
 * Computes aggregated metrics for strategies by combining metrics
 * from all strategy positions.
 */

import { PrismaClient } from '@midcurve/database';
import type {
  StrategyMetrics,
  StrategyPositionMetrics,
  StrategyPositionType,
  AnyToken,
  StrategyPositionInterface,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import {
  StrategyPositionMetricsService,
  type PositionValueCalculator,
} from '../strategy-position-metrics/strategy-position-metrics-service.js';

/**
 * Dependencies for StrategyMetricsService
 */
export interface StrategyMetricsServiceDependencies {
  /**
   * Prisma client for database operations
   */
  prisma?: PrismaClient;

  /**
   * Strategy position metrics service for computing per-position metrics
   */
  strategyPositionMetricsService?: StrategyPositionMetricsService;

  /**
   * Position value calculators keyed by position type
   * Passed to StrategyPositionMetricsService if creating one
   */
  positionValueCalculators?: Map<string, PositionValueCalculator>;
}

/**
 * Sum a bigint field across an array of metrics objects
 */
function sumBigInt(
  items: StrategyPositionMetrics[],
  field: keyof Omit<StrategyPositionMetrics, 'quoteToken'>
): bigint {
  return items.reduce((acc, item) => {
    const value = item[field];
    if (typeof value === 'bigint') {
      return acc + value;
    }
    return acc;
  }, 0n);
}

/**
 * Strategy Metrics Service
 *
 * Computes StrategyMetrics by:
 * 1. Fetching all strategy positions
 * 2. Computing StrategyPositionMetrics for each
 * 3. Aggregating into a single StrategyMetrics
 */
export class StrategyMetricsService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;
  private readonly strategyPositionMetricsService: StrategyPositionMetricsService;

  /**
   * Creates a new StrategyMetricsService instance
   */
  constructor(dependencies: StrategyMetricsServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyMetricsService');
    this.strategyPositionMetricsService =
      dependencies.strategyPositionMetricsService ??
      new StrategyPositionMetricsService({
        prisma: this.prisma,
        positionValueCalculators: dependencies.positionValueCalculators,
      });
  }

  /**
   * Register a value calculator for a position type
   *
   * Delegates to the underlying StrategyPositionMetricsService.
   *
   * @param positionType - Position type (e.g., 'hodl', 'uniswapv3')
   * @param calculator - Calculator implementation
   */
  registerValueCalculator(
    positionType: string,
    calculator: PositionValueCalculator
  ): void {
    this.strategyPositionMetricsService.registerValueCalculator(
      positionType,
      calculator
    );
  }

  /**
   * Compute metrics for a strategy by aggregating all position metrics
   *
   * @param strategyId - Strategy ID
   * @returns Computed StrategyMetrics
   * @throws Error if strategy not found or has no quote token
   */
  async getMetrics(strategyId: string): Promise<StrategyMetrics> {
    log.methodEntry(this.logger, 'getMetrics', { strategyId });

    try {
      // Fetch strategy with positions and quote token
      const strategy = await this.prisma.strategy.findUnique({
        where: { id: strategyId },
        include: {
          quoteToken: true,
          strategyPositions: true,
        },
      });

      if (!strategy) {
        throw new Error(`Strategy not found: ${strategyId}`);
      }

      if (!strategy.quoteToken) {
        throw new Error(`Strategy ${strategyId} has no quote token`);
      }

      // TODO: Use TokenService to properly convert token row to AnyToken
      const quoteToken = strategy.quoteToken as unknown as AnyToken;

      // Convert position rows to interfaces
      const positions: StrategyPositionInterface[] =
        strategy.strategyPositions.map((row) => ({
          id: row.id,
          strategyId: row.strategyId,
          positionType: row.positionType as StrategyPositionType,
          status: row.status as 'pending' | 'active' | 'paused' | 'closed',
          openedAt: row.openedAt,
          closedAt: row.closedAt,
          config: row.config as Record<string, unknown>,
          state: row.state as Record<string, unknown>,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          toJSON: () => ({
            id: row.id,
            strategyId: row.strategyId,
            positionType: row.positionType as StrategyPositionType,
            status: row.status as 'pending' | 'active' | 'paused' | 'closed',
            openedAt: row.openedAt?.toISOString() ?? null,
            closedAt: row.closedAt?.toISOString() ?? null,
            config: row.config as Record<string, unknown>,
            state: row.state as Record<string, unknown>,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }),
          getDisplayName: () => `Position ${row.id}`,
        }));

      // Compute metrics for each position
      const positionMetrics: StrategyPositionMetrics[] = await Promise.all(
        positions.map((position) =>
          this.strategyPositionMetricsService.getMetrics(position, quoteToken)
        )
      );

      // Aggregate into strategy metrics
      const metrics = this.aggregatePositionMetrics(quoteToken, positionMetrics);

      log.methodExit(this.logger, 'getMetrics', {
        strategyId,
        positionCount: positions.length,
        currentCostBasis: metrics.currentCostBasis.toString(),
        currentValue: metrics.currentValue.toString(),
      });

      return metrics;
    } catch (error) {
      log.methodError(this.logger, 'getMetrics', error as Error, { strategyId });
      throw error;
    }
  }

  /**
   * Aggregate position metrics into strategy metrics
   *
   * @param quoteToken - Quote token (same for all positions)
   * @param positionMetrics - Array of position metrics to aggregate
   * @returns Aggregated StrategyMetrics
   */
  private aggregatePositionMetrics(
    quoteToken: AnyToken,
    positionMetrics: StrategyPositionMetrics[]
  ): StrategyMetrics {
    return {
      quoteToken,
      currentCostBasis: sumBigInt(positionMetrics, 'currentCostBasis'),
      currentValue: sumBigInt(positionMetrics, 'currentValue'),
      realizedCapitalGain: sumBigInt(positionMetrics, 'realizedCapitalGain'),
      unrealizedIncome: sumBigInt(positionMetrics, 'unrealizedIncome'),
      realizedIncome: sumBigInt(positionMetrics, 'realizedIncome'),
      expenses: sumBigInt(positionMetrics, 'expenses'),
    };
  }

  /**
   * Create empty metrics for a strategy with no positions
   *
   * @param quoteToken - Quote token for the strategy
   * @returns StrategyMetrics with all values set to 0
   */
  createEmptyMetrics(quoteToken: AnyToken): StrategyMetrics {
    return {
      quoteToken,
      currentCostBasis: 0n,
      currentValue: 0n,
      realizedCapitalGain: 0n,
      unrealizedIncome: 0n,
      realizedIncome: 0n,
      expenses: 0n,
    };
  }
}
