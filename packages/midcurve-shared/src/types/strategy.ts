/**
 * Strategy Type Definitions
 *
 * Strategies are automated trading/liquidity management units deployed
 * as smart contracts on the internal SEMSEE EVM. They can manage multiple
 * positions across different protocols.
 */

import type { AnyPosition } from './position.js';
import type { AnyToken } from './token.js';

// =============================================================================
// STRATEGY STATE
// =============================================================================

/**
 * Strategy lifecycle states
 *
 * - pending: Created in DB, not yet deployed on-chain
 * - active: Running on-chain
 * - paused: Soft pause (DB-only, for UI/API control)
 * - shutdown: Permanently stopped
 */
export type StrategyState = 'pending' | 'active' | 'paused' | 'shutdown';

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
 * Aggregated metrics from all positions in a strategy
 *
 * All values are in quote token units (smallest denomination).
 * Field names match Position model for easy joins/views.
 */
export interface StrategyMetrics {
  /**
   * Sum of all position currentValue
   */
  currentValue: bigint;

  /**
   * Sum of all position currentCostBasis
   */
  currentCostBasis: bigint;

  /**
   * Sum of all position realizedPnl
   */
  realizedPnl: bigint;

  /**
   * Sum of all position unrealizedPnl
   */
  unrealizedPnl: bigint;

  /**
   * Sum of all position collectedFees
   */
  collectedFees: bigint;

  /**
   * Sum of all position unClaimedFees
   */
  unClaimedFees: bigint;

  /**
   * Sum of all position realizedCashflow
   */
  realizedCashflow: bigint;

  /**
   * Sum of all position unrealizedCashflow
   */
  unrealizedCashflow: bigint;
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
   * Current lifecycle state
   */
  state: StrategyState;

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
   * Quote token ID for metrics aggregation
   * All positions in this strategy must use the same quote token.
   * Set when first position is linked.
   */
  quoteTokenId: string | null;

  /**
   * Quote token reference (optional, populated when included)
   * All metrics are denominated in this token.
   * Generic type to support multiple platforms (ERC-20, SPL, etc.)
   */
  quoteToken?: AnyToken;

  // ============================================================================
  // METRICS
  // ============================================================================

  /**
   * Aggregated metrics from all linked positions
   */
  metrics: StrategyMetrics;

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
   * Positions managed by this strategy
   * Can include positions from any protocol (UniswapV3, Hyperliquid, etc.)
   */
  positions?: AnyPosition[];

  /**
   * Automation wallets linked to this strategy
   * One strategy can have multiple wallets (e.g., EVM, Hyperliquid)
   */
  automationWallets?: StrategyAutomationWallet[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create empty metrics with all zeros
 *
 * @returns StrategyMetrics with all fields set to 0n
 */
export function createEmptyMetrics(): StrategyMetrics {
  return {
    currentValue: 0n,
    currentCostBasis: 0n,
    realizedPnl: 0n,
    unrealizedPnl: 0n,
    collectedFees: 0n,
    unClaimedFees: 0n,
    realizedCashflow: 0n,
    unrealizedCashflow: 0n,
  };
}

/**
 * Aggregate metrics from multiple positions
 *
 * Sums all position metrics fields. All positions must use the same
 * quote token for meaningful aggregation.
 *
 * @param positions - Array of positions to aggregate
 * @returns Aggregated StrategyMetrics
 */
export function aggregatePositionMetrics(
  positions: AnyPosition[]
): StrategyMetrics {
  return positions.reduce(
    (acc, pos) => ({
      currentValue: acc.currentValue + pos.currentValue,
      currentCostBasis: acc.currentCostBasis + pos.currentCostBasis,
      realizedPnl: acc.realizedPnl + pos.realizedPnl,
      unrealizedPnl: acc.unrealizedPnl + pos.unrealizedPnl,
      collectedFees: acc.collectedFees + pos.collectedFees,
      unClaimedFees: acc.unClaimedFees + pos.unClaimedFees,
      realizedCashflow: acc.realizedCashflow + pos.realizedCashflow,
      unrealizedCashflow: acc.unrealizedCashflow + pos.unrealizedCashflow,
    }),
    createEmptyMetrics()
  );
}

/**
 * Calculate total PnL from strategy metrics
 *
 * Combines realized and unrealized PnL including cashflows.
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Total PnL in quote token units
 */
export function getTotalStrategyPnl(metrics: StrategyMetrics): bigint {
  return (
    metrics.realizedPnl +
    metrics.unrealizedPnl +
    metrics.realizedCashflow +
    metrics.unrealizedCashflow
  );
}

/**
 * Calculate total realized PnL from strategy metrics
 *
 * Combines realized PnL and realized cashflow.
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Total realized PnL in quote token units
 */
export function getTotalRealizedStrategyPnl(metrics: StrategyMetrics): bigint {
  return metrics.realizedPnl + metrics.realizedCashflow;
}

/**
 * Calculate total unrealized PnL from strategy metrics
 *
 * Combines unrealized PnL and unrealized cashflow.
 *
 * @param metrics - Strategy metrics to calculate from
 * @returns Total unrealized PnL in quote token units
 */
export function getTotalUnrealizedStrategyPnl(
  metrics: StrategyMetrics
): bigint {
  return metrics.unrealizedPnl + metrics.unrealizedCashflow;
}
