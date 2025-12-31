/**
 * Base Strategy Position
 *
 * Abstract base class implementing common functionality for all strategy positions.
 * Derived classes (StrategyTreasury, etc.) extend this class.
 */

import type { StrategyPositionInterface } from './strategy-position.interface.js';
import type {
  BaseStrategyPositionParams,
  StrategyPositionJSON,
  StrategyPositionStatus,
  StrategyPositionType,
} from './strategy-position.types.js';

/**
 * Base Strategy Position
 *
 * Provides common implementation for all strategy positions.
 * Derived classes must implement:
 * - positionType getter
 * - config getter
 * - state getter
 * - getDisplayName method
 */
export abstract class BaseStrategyPosition implements StrategyPositionInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  readonly id: string;
  readonly strategyId: string;

  /**
   * Position type discriminator (implemented by derived classes)
   */
  abstract readonly positionType: StrategyPositionType;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  readonly status: StrategyPositionStatus;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;

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

  constructor(params: BaseStrategyPositionParams) {
    this.id = params.id;
    this.strategyId = params.strategyId;
    this.status = params.status;
    this.openedAt = params.openedAt;
    this.closedAt = params.closedAt;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): StrategyPositionJSON {
    return {
      id: this.id,
      strategyId: this.strategyId,
      positionType: this.positionType,
      status: this.status,
      openedAt: this.openedAt?.toISOString() ?? null,
      closedAt: this.closedAt?.toISOString() ?? null,
      config: this.config,
      state: this.state,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get a human-readable display name for this position
   * (implemented by derived classes)
   */
  abstract getDisplayName(): string;
}
