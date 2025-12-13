/**
 * Strategy Position Interface
 *
 * Defines the contract for all strategy position implementations.
 * Each position type (treasury, uniswapv3, hyperliquid) implements this interface.
 */

import type {
  StrategyPositionJSON,
  StrategyPositionStatus,
  StrategyPositionType,
} from './strategy-position.types.js';

/**
 * Strategy Position Interface
 *
 * All strategy positions must implement this interface.
 * Provides a consistent API for working with different position types.
 */
export interface StrategyPositionInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  /**
   * Unique identifier (database-generated cuid)
   */
  readonly id: string;

  /**
   * Parent strategy ID
   */
  readonly strategyId: string;

  /**
   * Position type discriminator
   */
  readonly positionType: StrategyPositionType;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Current lifecycle status
   */
  readonly status: StrategyPositionStatus;

  /**
   * When position was opened (null if pending)
   */
  readonly openedAt: Date | null;

  /**
   * When position was closed (null if not closed)
   */
  readonly closedAt: Date | null;

  // ============================================================================
  // Type-specific Data (JSON)
  // ============================================================================

  /**
   * Immutable configuration (wallets, addresses, etc.)
   * Structure depends on positionType.
   */
  readonly config: Record<string, unknown>;

  /**
   * Mutable state (balances, holdings, etc.)
   * Structure depends on positionType.
   */
  readonly state: Record<string, unknown>;

  // ============================================================================
  // Timestamps
  // ============================================================================

  /**
   * When position was created in database
   */
  readonly createdAt: Date;

  /**
   * When position was last updated in database
   */
  readonly updatedAt: Date;

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): StrategyPositionJSON;

  /**
   * Get a human-readable display name for this position
   */
  getDisplayName(): string;
}
