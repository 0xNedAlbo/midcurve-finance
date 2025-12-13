/**
 * Strategy Position Types
 *
 * Type definitions for strategy-owned positions.
 * These are separate from user-owned positions (Position model).
 */

import type { AnyToken } from '../token.js';

/**
 * Strategy position lifecycle status
 *
 * - pending: Created in DB, not yet active
 * - active: Position is active and being managed
 * - paused: Position is temporarily paused
 * - closed: Position has been closed
 */
export type StrategyPositionStatus = 'pending' | 'active' | 'paused' | 'closed';

/**
 * Strategy position type discriminator
 *
 * Extensible for future position types:
 * - 'hodl': Token basket holding position
 * - 'uniswapv3': Uniswap V3 concentrated liquidity position
 * - 'hyperliquid': Hyperliquid perpetuals position
 */
export type StrategyPositionType = 'hodl' | 'uniswapv3' | 'hyperliquid';

/**
 * JSON-serializable representation of a strategy position
 *
 * Used for API responses and database storage.
 */
export interface StrategyPositionJSON {
  id: string;
  strategyId: string;
  positionType: StrategyPositionType;
  status: StrategyPositionStatus;
  openedAt: string | null;
  closedAt: string | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Base parameters for creating any strategy position
 */
export interface BaseStrategyPositionParams {
  id: string;
  strategyId: string;
  status: StrategyPositionStatus;
  openedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// STRATEGY POSITION METRICS
// =============================================================================

/**
 * Strategy Position Metrics - Per-position financial tracking
 *
 * Same structure as StrategyMetrics. Computed on-demand by
 * StrategyPositionMetricsService. Aggregates to produce StrategyMetrics.
 *
 * ## Data Sources
 *
 * | Field                | Source                           |
 * |----------------------|----------------------------------|
 * | currentCostBasis     | SUM(ledger.deltaCostBasis)       |
 * | currentValue         | Position state calculation       |
 * | realizedCapitalGain  | SUM(ledger.deltaRealizedCapitalGain) |
 * | unrealizedIncome     | Position state (unclaimed fees)  |
 * | realizedIncome       | SUM(ledger.deltaRealizedIncome)  |
 * | expenses             | SUM(ledger.deltaExpense)         |
 *
 * ## Aggregation
 *
 * ```typescript
 * // Strategy metrics = SUM of all position metrics
 * strategy.metrics = aggregatePositionMetrics(strategy.positions)
 * ```
 */
export interface StrategyPositionMetrics {
  /**
   * Quote token (reference currency for all values)
   * Inherited from parent strategy
   */
  quoteToken: AnyToken;

  // ============================================================================
  // CAPITAL (from current asset valuations)
  // ============================================================================

  /**
   * Sum of what was paid to acquire current assets in this position
   * Source: SUM(deltaCostBasis) from position's ledger events
   */
  currentCostBasis: bigint;

  /**
   * Current market value of this position's holdings
   * Source: Calculated from position state by position-specific calculator
   */
  currentValue: bigint;

  // Derived: unrealizedCapitalGain = currentValue - currentCostBasis

  // ============================================================================
  // CAPITAL GAINS (from ledger events)
  // ============================================================================

  /**
   * Realized capital gain/loss from asset sales in this position
   * Source: SUM(deltaRealizedCapitalGain) from position's ledger events
   */
  realizedCapitalGain: bigint;

  // ============================================================================
  // INCOME (e.g., AMM fees, yield, funding)
  // ============================================================================

  /**
   * Unrealized income for this position (unclaimed fees, pending yield)
   * Source: Calculated from position state (e.g., uncollected AMM fees)
   */
  unrealizedIncome: bigint;

  /**
   * Realized income for this position (collected fees, received funding)
   * Source: SUM(deltaRealizedIncome) from position's ledger events
   */
  realizedIncome: bigint;

  // ============================================================================
  // EXPENSES (always realized)
  // ============================================================================

  /**
   * Total expenses for this position (gas costs, protocol fees)
   * Source: SUM(deltaExpense) from position's ledger events
   */
  expenses: bigint;
}
