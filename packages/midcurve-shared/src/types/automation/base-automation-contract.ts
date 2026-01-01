/**
 * Base Automation Contract
 *
 * Abstract base class implementing common functionality for all automation contracts.
 * Derived classes (UniswapV3AutomationContract, etc.) extend this class.
 */

import type { AutomationContractInterface } from './automation-contract.interface.js';
import type {
  AutomationContractJSON,
  AutomationContractType,
  BaseAutomationContractParams,
} from './automation-contract.types.js';

/**
 * Base Automation Contract
 *
 * Provides common implementation for all automation contracts.
 * Derived classes must implement:
 * - contractType getter
 * - config getter
 * - state getter
 * - getDisplayName method
 */
export abstract class BaseAutomationContract implements AutomationContractInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  readonly id: string;

  /**
   * Contract type discriminator (implemented by derived classes)
   */
  abstract readonly contractType: AutomationContractType;

  readonly userId: string;

  // ============================================================================
  // Status
  // ============================================================================

  readonly isActive: boolean;

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

  constructor(params: BaseAutomationContractParams) {
    this.id = params.id;
    this.userId = params.userId;
    this.isActive = params.isActive;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): AutomationContractJSON {
    return {
      id: this.id,
      contractType: this.contractType,
      userId: this.userId,
      isActive: this.isActive,
      config: this.config,
      state: this.state,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get a human-readable display name for this contract
   * (implemented by derived classes)
   */
  abstract getDisplayName(): string;
}
