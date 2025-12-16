/**
 * Strategy Type Definitions
 *
 * Strategies are automated trading/liquidity management units deployed
 * as smart contracts on the internal SEMSEE EVM. They can manage multiple
 * positions across different protocols.
 */

import type { StrategyPositionInterface } from './strategy-position/strategy-position.interface.js';
import type { AnyToken } from './token.js';

// =============================================================================
// STRATEGY STATE
// =============================================================================

/**
 * Strategy lifecycle status (aligned with on-chain LifecycleMixin)
 *
 * - pending: Created in DB, not yet deployed on-chain
 * - deploying: Deployment in progress (contract being deployed)
 * - deployed: Contract deployed, not started (on-chain: DEPLOYED)
 * - starting: START event sent, processing (on-chain: STARTING)
 * - active: Fully running (on-chain: ACTIVE)
 * - shutting_down: SHUTDOWN event sent, cleanup in progress (on-chain: SHUTTING_DOWN)
 * - shutdown: Final state (on-chain: SHUTDOWN)
 */
export type StrategyStatus =
  | 'pending'
  | 'deploying'
  | 'deployed'
  | 'starting'
  | 'active'
  | 'shutting_down'
  | 'shutdown';

/**
 * @deprecated Use StrategyStatus instead
 */
export type StrategyState = StrategyStatus;

// =============================================================================
// STRATEGY CONFIG
// =============================================================================

/**
 * Strategy configuration (free-form JSON)
 *
 * Contains strategy-specific parameters, thresholds, target allocations, etc.
 * Structure is determined by the strategy type.
 */
export interface StrategyConfig {
  [key: string]: unknown;
}

// =============================================================================
// STRATEGY METRICS
// =============================================================================

/**
 * Strategy Metrics - Unified financial tracking
 *
 * All bigint values are denominated in quoteToken units (smallest denomination).
 * Computed on-demand by StrategyMetricsService from position metrics.
 * NOT stored in database.
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
 * ## Derived Calculations
 *
 * ```typescript
 * unrealizedCapitalGain = currentValue - currentCostBasis
 * totalUnrealizedPnl = unrealizedCapitalGain + unrealizedIncome
 * totalRealizedPnl = realizedCapitalGain + realizedIncome - expenses
 * totalPnl = totalUnrealizedPnl + totalRealizedPnl
 * ```
 */
export interface StrategyMetrics {
  /**
   * Quote token (reference currency for all values)
   * All bigint fields are denominated in this token's smallest units
   */
  quoteToken: AnyToken;

  // ============================================================================
  // CAPITAL (from current asset valuations)
  // ============================================================================

  /**
   * Sum of what was paid to acquire current assets
   * Source: SUM(deltaCostBasis) from ledger events
   */
  currentCostBasis: bigint;

  /**
   * Current market value of all holdings
   * Source: Calculated from position state by StrategyPositionMetricsService
   */
  currentValue: bigint;

  // Derived: unrealizedCapitalGain = currentValue - currentCostBasis

  // ============================================================================
  // CAPITAL GAINS (from ledger events)
  // ============================================================================

  /**
   * Realized capital gain/loss from asset sales
   * Source: SUM(deltaRealizedCapitalGain) from ledger events
   */
  realizedCapitalGain: bigint;

  // ============================================================================
  // INCOME (e.g., AMM fees, yield, funding)
  // ============================================================================

  /**
   * Unrealized income (unclaimed fees, pending yield)
   * Source: Calculated from position state (e.g., uncollected AMM fees)
   */
  unrealizedIncome: bigint;

  /**
   * Realized income (collected fees, received funding)
   * Source: SUM(deltaRealizedIncome) from ledger events
   */
  realizedIncome: bigint;

  // ============================================================================
  // EXPENSES (always realized)
  // ============================================================================

  /**
   * Total expenses (gas costs, protocol fees)
   * Source: SUM(deltaExpense) from ledger events
   */
  expenses: bigint;
}

// =============================================================================
// AUTOMATION WALLET (inline type for strategy reference)
// =============================================================================

/**
 * Automation wallet reference for strategy
 *
 * Simplified type representing automation wallets linked to a strategy.
 * Full AutomationWallet type is in the services layer.
 */
export interface StrategyAutomationWallet {
  id: string;
  walletType: string;
  label: string;
  walletHash: string;
  isActive: boolean;
  lastUsedAt: Date | null;
}

// =============================================================================
// STRATEGY INTERFACE
// =============================================================================

/**
 * Strategy interface
 *
 * Represents an automated trading/liquidity management unit that can
 * contain multiple positions across different protocols.
 */
export interface Strategy {
  /**
   * Unique identifier (database-generated cuid)
   */
  id: string;

  /**
   * Creation timestamp
   */
  createdAt: Date;

  /**
   * Last update timestamp
   */
  updatedAt: Date;

  // ============================================================================
  // OWNERSHIP
  // ============================================================================

  /**
   * User who owns this strategy
   * Foreign key reference to User.id
   */
  userId: string;

  // ============================================================================
  // IDENTIFICATION
  // ============================================================================

  /**
   * User-friendly name for the strategy
   * @example "ETH-USDC Delta Neutral"
   */
  name: string;

  /**
   * Strategy type/category identifier
   * @example "delta-neutral", "yield-optimizer", "range-rebalancer"
   */
  strategyType: string;

  /**
   * Current lifecycle status
   */
  status: StrategyStatus;

  // ============================================================================
  // ON-CHAIN IDENTIFICATION
  // ============================================================================

  /**
   * Contract address on internal SEMSEE EVM
   * Nullable until strategy is deployed on-chain
   * Serves as primary lookup field (unique)
   */
  contractAddress: string | null;

  /**
   * Chain ID where strategy is deployed (internal EVM)
   * Nullable until strategy is deployed on-chain
   */
  chainId: number | null;

  // ============================================================================
  // QUOTE TOKEN
  // ============================================================================

  /**
   * Quote token ID for metrics aggregation (required)
   * All positions in this strategy must use the same quote token.
   * Set from manifest.basicCurrencyId at creation time.
   */
  quoteTokenId: string;

  /**
   * Quote token reference (optional, populated when included)
   * All metrics are denominated in this token.
   * Generic type to support multiple platforms (ERC-20, SPL, etc.)
   */
  quoteToken?: AnyToken;

  // NOTE: Metrics are NOT stored on Strategy - computed on-demand by StrategyMetricsService
  // See: StrategyMetrics interface for the computed metrics structure

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Strategy-specific configuration (JSON)
   * Contains parameters, thresholds, target allocations, etc.
   */
  config: StrategyConfig;

  // ============================================================================
  // RELATIONS (optional, populated when included)
  // ============================================================================

  /**
   * Strategy-owned positions
   * Positions directly owned by the strategy (not user positions).
   * Includes Treasury baskets, managed LP positions, etc.
   */
  strategyPositions?: StrategyPositionInterface[];

  /**
   * Automation wallets linked to this strategy
   * One strategy can have multiple wallets (e.g., EVM, Hyperliquid)
   */
  automationWallets?: StrategyAutomationWallet[];
}

// =============================================================================
// METRICS HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate unrealized capital gain from strategy metrics
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Unrealized capital gain in quote token units (can be negative)
 */
export function getStrategyUnrealizedCapitalGain(metrics: StrategyMetrics): bigint {
  return metrics.currentValue - metrics.currentCostBasis;
}

/**
 * Calculate total unrealized PnL from strategy metrics
 *
 * Combines unrealized capital gain and unrealized income.
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Total unrealized PnL in quote token units
 */
export function getStrategyTotalUnrealizedPnl(metrics: StrategyMetrics): bigint {
  const unrealizedCapitalGain = getStrategyUnrealizedCapitalGain(metrics);
  return unrealizedCapitalGain + metrics.unrealizedIncome;
}

/**
 * Calculate total realized PnL from strategy metrics
 *
 * Combines realized capital gain, realized income, minus expenses.
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Total realized PnL in quote token units
 */
export function getStrategyTotalRealizedPnl(metrics: StrategyMetrics): bigint {
  return (
    metrics.realizedCapitalGain + metrics.realizedIncome - metrics.expenses
  );
}

/**
 * Calculate total PnL from strategy metrics
 *
 * Combines unrealized and realized PnL.
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Total PnL in quote token units
 */
export function getStrategyTotalPnl(metrics: StrategyMetrics): bigint {
  return getStrategyTotalUnrealizedPnl(metrics) + getStrategyTotalRealizedPnl(metrics);
}

/**
 * @deprecated Use getStrategyTotalPnl instead
 */
export const getTotalStrategyPnl = getStrategyTotalPnl;

/**
 * @deprecated Use getStrategyTotalRealizedPnl instead
 */
export const getTotalRealizedStrategyPnl = getStrategyTotalRealizedPnl;

/**
 * @deprecated Use getStrategyTotalUnrealizedPnl instead
 */
export const getTotalUnrealizedStrategyPnl = getStrategyTotalUnrealizedPnl;

