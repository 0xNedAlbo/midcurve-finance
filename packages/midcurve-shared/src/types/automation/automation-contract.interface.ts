/**
 * Automation Contract Interface
 *
 * Defines the contract for all automation contract implementations.
 * Each protocol (uniswapv3, orca, etc.) implements this interface.
 */

import type {
  AutomationContractJSON,
  AutomationContractType,
} from './automation-contract.types.js';

/**
 * Automation Contract Interface
 *
 * All automation contracts must implement this interface.
 * Provides a consistent API for working with different protocol contracts.
 */
export interface AutomationContractInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  /**
   * Unique identifier (database-generated cuid)
   */
  readonly id: string;

  /**
   * Contract type discriminator
   */
  readonly contractType: AutomationContractType;

  /**
   * Owner user ID
   */
  readonly userId: string;

  // ============================================================================
  // Status
  // ============================================================================

  /**
   * Whether the contract is active
   */
  readonly isActive: boolean;

  // ============================================================================
  // Type-specific Data (JSON)
  // ============================================================================

  /**
   * Immutable configuration (addresses, chain, etc.)
   * Structure depends on contractType.
   */
  readonly config: Record<string, unknown>;

  /**
   * Mutable state (deployment status, etc.)
   * Structure depends on contractType.
   */
  readonly state: Record<string, unknown>;

  // ============================================================================
  // Timestamps
  // ============================================================================

  /**
   * When contract record was created in database
   */
  readonly createdAt: Date;

  /**
   * When contract record was last updated in database
   */
  readonly updatedAt: Date;

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): AutomationContractJSON;

  /**
   * Get a human-readable display name for this contract
   */
  getDisplayName(): string;
}
