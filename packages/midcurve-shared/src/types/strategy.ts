/**
 * Strategy Type Definitions
 *
 * Strategies are automated trading/liquidity management units deployed
 * as smart contracts on the internal SEMSEE EVM. They can manage multiple
 * positions across different protocols.
 */

import type { AnyPosition } from './position.js';
import type { AnyToken, Erc20TokenConfig } from './token.js';
import { normalizeToBasicCurrencyDecimals } from '../utils/decimals.js';

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

  /**
   * Position IDs that were skipped during metrics aggregation.
   *
   * Positions are skipped when their quote token is not linkable to the
   * strategy's basic currency (quoteTokenId). This allows the UI to display
   * which positions are not included in the strategy's metrics.
   */
  skippedPositionIds: string[];

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

// =============================================================================
// BASIC CURRENCY AGGREGATION
// =============================================================================

/**
 * Result of aggregation with basic currency normalization
 */
export interface AggregationResult {
  /**
   * Aggregated metrics normalized to basic currency decimals (18)
   */
  metrics: StrategyMetrics;

  /**
   * IDs of positions that were included in aggregation
   */
  includedPositionIds: string[];

  /**
   * IDs of positions that were skipped during aggregation
   */
  skippedPositionIds: string[];

  /**
   * Reasons why each position was skipped (for debugging/logging)
   */
  skipReasons: Map<string, string>;
}

/**
 * Position with its resolved quote token for aggregation
 *
 * The resolvedQuoteToken is determined by the position's isToken0Quote flag
 * and the pool's token0/token1.
 */
export interface PositionWithQuoteToken {
  /**
   * The position to aggregate
   */
  position: AnyPosition;

  /**
   * The resolved quote token for this position
   * (pool.token0 if isToken0Quote, else pool.token1)
   */
  quoteToken: AnyToken;
}

/**
 * Resolves the basic currency ID for a given token.
 *
 * - If token is a basic currency, returns its own ID
 * - If token is ERC-20 with basicCurrencyId, returns that ID
 * - Otherwise returns null (token is not linkable)
 *
 * @param token - Token to resolve basic currency for
 * @returns Basic currency ID or null if not linkable
 */
export function resolveBasicCurrencyId(token: AnyToken): string | null {
  if (token.tokenType === 'basic-currency') {
    // Token IS a basic currency
    return token.id;
  }

  if (token.tokenType === 'erc20') {
    // Check if ERC-20 token is linked to a basic currency
    const config = token.config as Erc20TokenConfig;
    return config.basicCurrencyId ?? null;
  }

  // Unknown token type - not linkable
  return null;
}

/**
 * Aggregate position metrics with basic currency normalization.
 *
 * This function:
 * 1. Checks if each position's quote token is linkable to the target basic currency
 * 2. Converts position metrics from quote token decimals to basic currency decimals (18)
 * 3. Skips positions whose quote tokens aren't linked to the target basic currency
 *
 * @param positions - Positions with their resolved quote tokens
 * @param targetBasicCurrencyId - Target basic currency ID for the strategy
 * @returns Aggregated metrics and information about skipped positions
 *
 * @example
 * const positions = [
 *   { position: usdcPosition, quoteToken: usdcToken }, // USDC linked to USD
 *   { position: ethPosition, quoteToken: wethToken },  // WETH linked to ETH (skipped)
 * ];
 * const result = aggregatePositionMetricsWithBasicCurrency(positions, usdBasicCurrencyId);
 * // result.metrics contains only USDC position metrics, normalized to 18 decimals
 * // result.skippedPositionIds contains the ETH position ID
 */
export function aggregatePositionMetricsWithBasicCurrency(
  positions: PositionWithQuoteToken[],
  targetBasicCurrencyId: string
): AggregationResult {
  const result: AggregationResult = {
    metrics: createEmptyMetrics(),
    includedPositionIds: [],
    skippedPositionIds: [],
    skipReasons: new Map(),
  };

  for (const { position, quoteToken } of positions) {
    // Resolve the basic currency for this position's quote token
    const linkedBasicCurrencyId = resolveBasicCurrencyId(quoteToken);

    // Check if quote token is linkable
    if (linkedBasicCurrencyId === null) {
      result.skippedPositionIds.push(position.id);
      result.skipReasons.set(
        position.id,
        `Quote token ${quoteToken.symbol} (${quoteToken.tokenType}) has no linked basic currency`
      );
      continue;
    }

    // Check if linked to the same basic currency as the strategy
    if (linkedBasicCurrencyId !== targetBasicCurrencyId) {
      result.skippedPositionIds.push(position.id);
      result.skipReasons.set(
        position.id,
        `Quote token ${quoteToken.symbol} is linked to different basic currency (${linkedBasicCurrencyId})`
      );
      continue;
    }

    // Position is compatible - add metrics with decimal normalization
    const decimals = quoteToken.decimals;

    result.metrics.currentValue += normalizeToBasicCurrencyDecimals(
      position.currentValue,
      decimals
    );
    result.metrics.currentCostBasis += normalizeToBasicCurrencyDecimals(
      position.currentCostBasis,
      decimals
    );
    result.metrics.realizedPnl += normalizeToBasicCurrencyDecimals(
      position.realizedPnl,
      decimals
    );
    result.metrics.unrealizedPnl += normalizeToBasicCurrencyDecimals(
      position.unrealizedPnl,
      decimals
    );
    result.metrics.collectedFees += normalizeToBasicCurrencyDecimals(
      position.collectedFees,
      decimals
    );
    result.metrics.unClaimedFees += normalizeToBasicCurrencyDecimals(
      position.unClaimedFees,
      decimals
    );
    result.metrics.realizedCashflow += normalizeToBasicCurrencyDecimals(
      position.realizedCashflow,
      decimals
    );
    result.metrics.unrealizedCashflow += normalizeToBasicCurrencyDecimals(
      position.unrealizedCashflow,
      decimals
    );

    result.includedPositionIds.push(position.id);
  }

  return result;
}
