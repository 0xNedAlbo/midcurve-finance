/**
 * Strategy Treasury
 *
 * Represents a Treasury (token basket) position within a strategy.
 * Tracks multiple tokens held across one or more wallets.
 */

import { BaseStrategyPosition } from '../base-strategy-position.js';
import type { BaseStrategyPositionParams, StrategyPositionType } from '../strategy-position.types.js';
import { TreasuryConfig } from './treasury-config.js';
import { TreasuryState } from './treasury-state.js';

/**
 * Parameters for creating a Strategy Treasury
 */
export interface StrategyTreasuryParams extends BaseStrategyPositionParams {
  config: TreasuryConfig;
  state: TreasuryState;
}

/**
 * Database row representation for factory pattern
 */
export interface StrategyTreasuryRow {
  id: string;
  strategyId: string;
  positionType: 'treasury';
  status: 'pending' | 'active' | 'paused' | 'closed';
  openedAt: Date | null;
  closedAt: Date | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Strategy Treasury
 *
 * A position that tracks a basket of tokens (holdings) across wallets.
 * Inherits from BaseStrategyPosition and implements Treasury-specific logic.
 */
export class StrategyTreasury extends BaseStrategyPosition {
  readonly positionType: StrategyPositionType = 'treasury';

  private readonly _config: TreasuryConfig;
  private readonly _state: TreasuryState;

  constructor(params: StrategyTreasuryParams) {
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
  get typedConfig(): TreasuryConfig {
    return this._config;
  }

  /**
   * Get typed state object
   */
  get typedState(): TreasuryState {
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
  static fromDB(row: StrategyTreasuryRow): StrategyTreasury {
    return new StrategyTreasury({
      id: row.id,
      strategyId: row.strategyId,
      status: row.status,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      config: TreasuryConfig.fromJSON(row.config),
      state: TreasuryState.fromJSON(row.state),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
