/**
 * Hedge Vault Input Types
 *
 * Input types for HedgeVaultService layer operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

// =============================================================================
// HEDGE VAULT INPUT TYPES
// =============================================================================

/**
 * Vault state enum matching the contract
 */
export type HedgeVaultState =
  | 'UNINITIALIZED'
  | 'IN_POSITION'
  | 'OUT_OF_POSITION_QUOTE'
  | 'OUT_OF_POSITION_BASE'
  | 'DEAD';

/**
 * Monitoring status for hedge vaults
 */
export type HedgeVaultMonitoringStatus = 'pending' | 'active' | 'paused' | 'stopped';

/**
 * Execution status for hedge vault operations
 */
export type HedgeVaultExecutionStatus = 'pending' | 'executing' | 'completed' | 'failed';

/**
 * Trigger type for hedge vault operations
 */
export type HedgeVaultTriggerType = 'sil' | 'tip' | 'reopen';

/**
 * Input for registering a new hedge vault for monitoring
 */
export interface RegisterHedgeVaultInput {
  /**
   * On-chain vault contract address
   */
  vaultAddress: string;

  /**
   * Chain ID where the vault is deployed
   */
  chainId: number;

  /**
   * Optional position ID if tracking a specific position
   */
  positionId?: string;

  /**
   * Uniswap V3 pool address
   */
  poolAddress: string;

  /**
   * Whether token0 is the quote token
   */
  token0IsQuote: boolean;

  /**
   * SIL trigger threshold (sqrtPriceX96 format as string)
   */
  silSqrtPriceX96: string;

  /**
   * TIP trigger threshold (sqrtPriceX96 format as string)
   */
  tipSqrtPriceX96: string;

  /**
   * Loss cap in basis points (e.g., 1000 = 10%)
   */
  lossCapBps: number;

  /**
   * Blocks to wait before reopen is allowed
   */
  reopenCooldownBlocks: bigint;

  /**
   * Operator wallet ID (optional, for executing triggers)
   */
  operatorId?: string;
}

/**
 * Input for updating hedge vault state from chain
 */
export interface UpdateHedgeVaultStateInput {
  /**
   * Current vault state
   */
  state: HedgeVaultState;

  /**
   * Current NFT token ID (if in position)
   */
  currentTokenId?: string;

  /**
   * Block when position was last closed
   */
  lastCloseBlock?: bigint;

  /**
   * Total cost basis in quote tokens
   */
  costBasis?: string;
}

/**
 * Input for recording a hedge vault execution attempt
 */
export interface RecordHedgeVaultExecutionInput {
  /**
   * Type of trigger (sil, tip, reopen)
   */
  triggerType: HedgeVaultTriggerType;

  /**
   * Price that triggered the execution (sqrtPriceX96 as string)
   */
  triggerSqrtPriceX96: string;
}

/**
 * Input for marking execution as completed
 */
export interface MarkExecutionCompletedInput {
  /**
   * Transaction hash
   */
  txHash: string;

  /**
   * Price at execution time (sqrtPriceX96 as string)
   */
  executionSqrtPriceX96: string;

  /**
   * Quote token amount (if applicable)
   */
  quoteAmount?: string;

  /**
   * Base token amount (if applicable)
   */
  baseAmount?: string;
}

/**
 * Input for marking execution as failed
 */
export interface MarkExecutionFailedInput {
  /**
   * Error message
   */
  error: string;

  /**
   * Current retry count
   */
  retryCount: number;
}

/**
 * Options for finding hedge vaults
 */
export interface FindHedgeVaultsOptions {
  /**
   * Filter by chain ID
   */
  chainId?: number;

  /**
   * Filter by pool address
   */
  poolAddress?: string;

  /**
   * Filter by vault state
   */
  state?: HedgeVaultState;

  /**
   * Filter by monitoring status
   */
  monitoringStatus?: HedgeVaultMonitoringStatus;

  /**
   * Include executions in response
   */
  includeExecutions?: boolean;

  /**
   * Limit number of results
   */
  limit?: number;
}
