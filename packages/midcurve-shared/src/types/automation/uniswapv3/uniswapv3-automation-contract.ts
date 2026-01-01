/**
 * UniswapV3 Automation Contract
 *
 * Concrete implementation of automation contract for UniswapV3.
 * Extends BaseAutomationContract with UniswapV3-specific config and state.
 */

import { BaseAutomationContract } from '../base-automation-contract.js';
import type {
  AutomationContractType,
  BaseAutomationContractParams,
} from '../automation-contract.types.js';
import {
  UniswapV3ContractConfig,
  type UniswapV3ContractConfigJSON,
} from './uniswapv3-contract-config.js';
import {
  UniswapV3ContractState,
  type UniswapV3ContractStateJSON,
} from './uniswapv3-contract-state.js';

/**
 * Parameters for creating a UniswapV3 automation contract
 */
export interface UniswapV3AutomationContractParams extends BaseAutomationContractParams {
  config: UniswapV3ContractConfig;
  state: UniswapV3ContractState;
}

/**
 * Database row representation for factory pattern
 */
export interface UniswapV3AutomationContractRow {
  id: string;
  contractType: 'uniswapv3';
  userId: string;
  isActive: boolean;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * UniswapV3 Automation Contract
 *
 * A deployed UniswapV3PositionCloser contract that can close positions
 * when price thresholds are triggered.
 */
export class UniswapV3AutomationContract extends BaseAutomationContract {
  readonly contractType: AutomationContractType = 'uniswapv3';

  private readonly _config: UniswapV3ContractConfig;
  private readonly _state: UniswapV3ContractState;

  constructor(params: UniswapV3AutomationContractParams) {
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
  get typedConfig(): UniswapV3ContractConfig {
    return this._config;
  }

  /**
   * Get typed state object
   */
  get typedState(): UniswapV3ContractState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors
  // ============================================================================

  /**
   * Get chain ID from config
   */
  get chainId(): number {
    return this._config.chainId;
  }

  /**
   * Get contract address from config
   */
  get contractAddress(): string {
    return this._config.contractAddress;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Get a human-readable display name for this contract
   */
  getDisplayName(): string {
    const { chainId, contractAddress } = this._config;
    const shortAddress = `${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`;
    return `UniswapV3 Closer (Chain ${chainId}, ${shortAddress})`;
  }

  /**
   * Check if contract is deployed on-chain
   */
  isDeployed(): boolean {
    return this._state.isDeployed();
  }

  /**
   * Get the next close ID for registering new orders
   */
  getNextCloseId(): number {
    return this._state.getNextCloseId();
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /**
   * Create from database row
   */
  static fromDB(row: UniswapV3AutomationContractRow): UniswapV3AutomationContract {
    return new UniswapV3AutomationContract({
      id: row.id,
      userId: row.userId,
      isActive: row.isActive,
      config: UniswapV3ContractConfig.fromJSON(
        row.config as unknown as UniswapV3ContractConfigJSON
      ),
      state: UniswapV3ContractState.fromJSON(
        row.state as unknown as UniswapV3ContractStateJSON
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
