/**
 * Close Order Interface
 *
 * Defines the contract for all close order implementations.
 * Each protocol (uniswapv3, orca, etc.) implements this interface.
 */

import type {
  AutomationContractConfig,
  CloseOrderJSON,
  CloseOrderStatus,
  CloseOrderType,
} from './close-order.types.js';

/**
 * Close Order Interface
 *
 * All close orders must implement this interface.
 * Provides a consistent API for working with different protocol close orders.
 */
export interface CloseOrderInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  /**
   * Unique identifier (database-generated cuid)
   */
  readonly id: string;

  /**
   * Semantic identifier for URL-based lookups
   * Format: "sl@{tick}" or "tp@{tick}" (e.g., "sl@-12345", "tp@201120")
   * Derived from triggerMode + sqrtPriceX96 threshold
   */
  readonly closeOrderHash: string | null;

  /**
   * Automation contract configuration (immutable at registration time)
   * Contains shared contract address used for this order
   */
  readonly automationContractConfig: AutomationContractConfig;

  /**
   * Close order type discriminator
   */
  readonly closeOrderType: CloseOrderType;

  // ============================================================================
  // Position Link
  // ============================================================================

  /**
   * Required position link
   *
   * The position this close order is configured to close.
   * Always required - automation is always for a specific position.
   */
  readonly positionId: string;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Current lifecycle status
   */
  readonly status: CloseOrderStatus;

  // ============================================================================
  // Type-specific Data (JSON)
  // ============================================================================

  /**
   * Immutable configuration (price triggers, slippage, etc.)
   * Structure depends on orderType.
   */
  readonly config: Record<string, unknown>;

  /**
   * Mutable state (execution status, tx hashes, etc.)
   * Structure depends on orderType.
   */
  readonly state: Record<string, unknown>;

  // ============================================================================
  // Timestamps
  // ============================================================================

  /**
   * When order was created in database
   */
  readonly createdAt: Date;

  /**
   * When order was last updated in database
   */
  readonly updatedAt: Date;

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): CloseOrderJSON;

  /**
   * Get a human-readable display name for this order
   */
  getDisplayName(): string;
}
