/**
 * HODL Strategy Position
 *
 * Represents a HODL (token basket) position within a strategy.
 * Tracks multiple tokens held across one or more wallets.
 */

import { BaseStrategyPosition } from '../base-strategy-position.js';
import type { BaseStrategyPositionParams, StrategyPositionType } from '../strategy-position.types.js';
import { HodlPositionConfig } from './hodl-position-config.js';
import { HodlPositionState } from './hodl-position-state.js';

/**
 * Parameters for creating a HODL strategy position
 */
export interface HodlStrategyPositionParams extends BaseStrategyPositionParams {
  config: HodlPositionConfig;
  state: HodlPositionState;
}

/**
 * Database row representation for factory pattern
 */
export interface HodlStrategyPositionRow {
  id: string;
  strategyId: string;
  positionType: 'hodl';
  status: 'pending' | 'active' | 'paused' | 'closed';
  openedAt: Date | null;
  closedAt: Date | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * HODL Strategy Position
 *
 * A position that tracks a basket of tokens (holdings) across wallets.
 * Inherits from BaseStrategyPosition and implements HODL-specific logic.
 */
export class HodlStrategyPosition extends BaseStrategyPosition {
  readonly positionType: StrategyPositionType = 'hodl';

  private readonly _config: HodlPositionConfig;
  private readonly _state: HodlPositionState;

  constructor(params: HodlStrategyPositionParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Interface Implementation
  // ============================================================================

  /**
   * Get configuration as generic Record for interface compliance
   */
  get config(): Record<string, unknown> {
    return this._config.toJSON();
  }

  /**
   * Get state as generic Record for interface compliance
   */
  get state(): Record<string, unknown> {
    return this._state.toJSON();
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  /**
   * Get typed configuration object
   */
  get typedConfig(): HodlPositionConfig {
    return this._config;
  }

  /**
   * Get typed state object
   */
  get typedState(): HodlPositionState {
    return this._state;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Get a human-readable display name for this position
   */
  getDisplayName(): string {
    const tokenCount = this._state.getTokenCount();
    if (tokenCount === 0) {
      return 'Empty Holdings';
    }
    if (tokenCount === 1) {
      return 'Holdings (1 token)';
    }
    return `Holdings (${tokenCount} tokens)`;
  }

  /**
   * Get the number of tokens in the basket
   */
  getTokenCount(): number {
    return this._state.getTokenCount();
  }

  /**
   * Get the number of configured wallets
   */
  getWalletCount(): number {
    return this._config.getWalletCount();
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /**
   * Create from database row
   */
  static fromDB(row: HodlStrategyPositionRow): HodlStrategyPosition {
    return new HodlStrategyPosition({
      id: row.id,
      strategyId: row.strategyId,
      status: row.status,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      config: HodlPositionConfig.fromJSON(row.config),
      state: HodlPositionState.fromJSON(row.state),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
