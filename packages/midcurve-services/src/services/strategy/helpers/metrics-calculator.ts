/**
 * Strategy Metrics Calculator
 *
 * Utilities for calculating aggregated metrics from positions.
 * Re-exports shared functions and provides additional database-specific helpers.
 */

import type { StrategyMetrics } from '@midcurve/shared';
import { createEmptyMetrics, aggregatePositionMetrics } from '@midcurve/shared';

// Re-export shared functions
export { createEmptyMetrics, aggregatePositionMetrics };

/**
 * Database result type for metrics fields
 * All bigint values are stored as strings in the database
 */
interface MetricsDbResult {
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  collectedFees: string;
  unClaimedFees: string;
  realizedCashflow: string;
  unrealizedCashflow: string;
}

/**
 * Parse metrics from database string values to bigints
 *
 * @param dbResult - Database result with string values
 * @returns StrategyMetrics with bigint values
 */
export function parseMetricsFromDb(dbResult: MetricsDbResult): StrategyMetrics {
  return {
    currentValue: BigInt(dbResult.currentValue),
    currentCostBasis: BigInt(dbResult.currentCostBasis),
    realizedPnl: BigInt(dbResult.realizedPnl),
    unrealizedPnl: BigInt(dbResult.unrealizedPnl),
    collectedFees: BigInt(dbResult.collectedFees),
    unClaimedFees: BigInt(dbResult.unClaimedFees),
    realizedCashflow: BigInt(dbResult.realizedCashflow),
    unrealizedCashflow: BigInt(dbResult.unrealizedCashflow),
  };
}

/**
 * Serialize metrics to database string values
 *
 * @param metrics - StrategyMetrics with bigint values
 * @returns Object with string values for database storage
 */
export function serializeMetricsToDb(metrics: StrategyMetrics): MetricsDbResult {
  return {
    currentValue: metrics.currentValue.toString(),
    currentCostBasis: metrics.currentCostBasis.toString(),
    realizedPnl: metrics.realizedPnl.toString(),
    unrealizedPnl: metrics.unrealizedPnl.toString(),
    collectedFees: metrics.collectedFees.toString(),
    unClaimedFees: metrics.unClaimedFees.toString(),
    realizedCashflow: metrics.realizedCashflow.toString(),
    unrealizedCashflow: metrics.unrealizedCashflow.toString(),
  };
}

/**
 * Error thrown when quote tokens don't match
 */
export class StrategyQuoteTokenMismatchError extends Error {
  public readonly strategyId: string;
  public readonly strategyQuoteTokenId: string;
  public readonly positionQuoteTokenId: string;

  constructor(
    strategyId: string,
    strategyQuoteTokenId: string,
    positionQuoteTokenId: string
  ) {
    super(
      `Quote token mismatch for strategy ${strategyId}: ` +
        `strategy uses ${strategyQuoteTokenId}, ` +
        `but position uses ${positionQuoteTokenId}. ` +
        `All positions in a strategy must use the same quote token.`
    );
    this.name = 'StrategyQuoteTokenMismatchError';
    this.strategyId = strategyId;
    this.strategyQuoteTokenId = strategyQuoteTokenId;
    this.positionQuoteTokenId = positionQuoteTokenId;
  }
}
