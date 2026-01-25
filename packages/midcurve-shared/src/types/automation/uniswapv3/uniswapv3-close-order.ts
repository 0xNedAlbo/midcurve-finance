/**
 * UniswapV3 Close Order
 *
 * Concrete implementation of close order for UniswapV3 positions.
 * Extends BaseCloseOrder with UniswapV3-specific config and state.
 */

import { BaseCloseOrder } from '../base-close-order.js';
import type {
  AutomationContractConfig,
  BaseCloseOrderParams,
  CloseOrderStatus,
  CloseOrderType,
} from '../close-order.types.js';
import {
  UniswapV3CloseOrderConfig,
  type UniswapV3CloseOrderConfigJSON,
} from './uniswapv3-close-order-config.js';
import {
  UniswapV3CloseOrderState,
  type UniswapV3CloseOrderStateJSON,
} from './uniswapv3-close-order-state.js';

/**
 * Parameters for creating a UniswapV3 close order
 */
export interface UniswapV3CloseOrderParams extends BaseCloseOrderParams {
  config: UniswapV3CloseOrderConfig;
  state: UniswapV3CloseOrderState;
}

/**
 * Database row representation for factory pattern
 */
export interface UniswapV3CloseOrderRow {
  id: string;
  closeOrderHash: string | null;
  closeOrderType: 'uniswapv3';
  automationContractConfig: Record<string, unknown>;
  status: CloseOrderStatus;
  positionId: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * UniswapV3 Close Order
 *
 * A close order that monitors price thresholds for a UniswapV3 position
 * and triggers automatic closing when conditions are met.
 */
export class UniswapV3CloseOrder extends BaseCloseOrder {
  readonly closeOrderType: CloseOrderType = 'uniswapv3';

  private readonly _config: UniswapV3CloseOrderConfig;
  private readonly _state: UniswapV3CloseOrderState;

  constructor(params: UniswapV3CloseOrderParams) {
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
    return this._config.toJSON() as unknown as Record<string, unknown>;
  }

  /**
   * Get state as generic Record for interface compliance
   */
  get state(): Record<string, unknown> {
    return this._state.toJSON() as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  /**
   * Get typed configuration object
   */
  get typedConfig(): UniswapV3CloseOrderConfig {
    return this._config;
  }

  /**
   * Get typed state object
   */
  get typedState(): UniswapV3CloseOrderState {
    return this._state;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Get a human-readable display name for this order
   */
  getDisplayName(): string {
    const { closeId, nftId, triggerMode } = this._config;
    return `Close #${closeId} (NFT ${nftId}, ${triggerMode})`;
  }

  /**
   * Check if order has been registered on-chain
   */
  isRegistered(): boolean {
    return this._state.registeredAt !== null;
  }

  /**
   * Check if order has been triggered
   */
  isTriggered(): boolean {
    return this._state.triggeredAt !== null;
  }

  /**
   * Check if order has been executed
   */
  isExecuted(): boolean {
    return this._state.executedAt !== null;
  }

  /**
   * Check if order has expired
   */
  isExpired(): boolean {
    return this._config.validUntil < new Date();
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /**
   * Create from database row
   */
  static fromDB(row: UniswapV3CloseOrderRow): UniswapV3CloseOrder {
    return new UniswapV3CloseOrder({
      id: row.id,
      closeOrderHash: row.closeOrderHash,
      automationContractConfig: row.automationContractConfig as unknown as AutomationContractConfig,
      status: row.status,
      positionId: row.positionId,
      config: UniswapV3CloseOrderConfig.fromJSON(
        row.config as unknown as UniswapV3CloseOrderConfigJSON
      ),
      state: UniswapV3CloseOrderState.fromJSON(
        row.state as unknown as UniswapV3CloseOrderStateJSON
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
