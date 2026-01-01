/**
 * Base Close Order
 *
 * Abstract base class implementing common functionality for all close orders.
 * Derived classes (UniswapV3CloseOrder, etc.) extend this class.
 */

import type { CloseOrderInterface } from './close-order.interface.js';
import type {
  BaseCloseOrderParams,
  CloseOrderJSON,
  CloseOrderStatus,
  CloseOrderType,
} from './close-order.types.js';

/**
 * Base Close Order
 *
 * Provides common implementation for all close orders.
 * Derived classes must implement:
 * - orderType getter
 * - config getter
 * - state getter
 * - getDisplayName method
 */
export abstract class BaseCloseOrder implements CloseOrderInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  readonly id: string;
  readonly contractId: string;

  /**
   * Order type discriminator (implemented by derived classes)
   */
  abstract readonly orderType: CloseOrderType;

  // ============================================================================
  // Position Link
  // ============================================================================

  readonly positionId: string;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  readonly status: CloseOrderStatus;

  // ============================================================================
  // Timestamps
  // ============================================================================

  readonly createdAt: Date;
  readonly updatedAt: Date;

  // ============================================================================
  // Type-specific Data (implemented by derived classes)
  // ============================================================================

  /**
   * Get configuration as generic Record for interface compliance
   */
  abstract get config(): Record<string, unknown>;

  /**
   * Get state as generic Record for interface compliance
   */
  abstract get state(): Record<string, unknown>;

  // ============================================================================
  // Constructor
  // ============================================================================

  constructor(params: BaseCloseOrderParams) {
    this.id = params.id;
    this.contractId = params.contractId;
    this.status = params.status;
    this.positionId = params.positionId;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): CloseOrderJSON {
    return {
      id: this.id,
      contractId: this.contractId,
      orderType: this.orderType,
      status: this.status,
      positionId: this.positionId,
      config: this.config,
      state: this.state,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get a human-readable display name for this order
   * (implemented by derived classes)
   */
  abstract getDisplayName(): string;
}
