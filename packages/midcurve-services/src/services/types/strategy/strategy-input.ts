/**
 * Strategy Input Types
 *
 * Input types for Strategy CRUD operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

import type { StrategyState, StrategyConfig } from '@midcurve/shared';

/**
 * Input type for creating a new strategy
 */
export interface CreateStrategyInput {
  /**
   * User ID who owns this strategy
   */
  userId: string;

  /**
   * User-friendly name for the strategy
   * @example "ETH-USDC Delta Neutral"
   */
  name: string;

  /**
   * Strategy type/category identifier
   * @example "delta-neutral", "yield-optimizer"
   */
  strategyType: string;

  /**
   * Strategy-specific configuration (JSON)
   */
  config: StrategyConfig;

  /**
   * Initial quote token ID (optional)
   * If not provided, will be set when first position is linked.
   */
  quoteTokenId?: string;
}

/**
 * Input type for updating an existing strategy
 * All fields are optional (partial update).
 */
export interface UpdateStrategyInput {
  /**
   * Updated name
   */
  name?: string;

  /**
   * Updated strategy type
   */
  strategyType?: string;

  /**
   * Updated configuration
   */
  config?: StrategyConfig;
}

/**
 * Input type for activating a strategy (pending -> active)
 * Requires on-chain deployment information.
 */
export interface ActivateStrategyInput {
  /**
   * Chain ID where strategy is deployed (internal EVM)
   */
  chainId: number;

  /**
   * Contract address on the internal EVM
   */
  contractAddress: string;
}

/**
 * Options for finding strategies
 */
export interface FindStrategyOptions {
  /**
   * Filter by state(s)
   */
  state?: StrategyState | StrategyState[];

  /**
   * Filter by strategy type
   */
  strategyType?: string;

  /**
   * Include linked positions in result
   */
  includePositions?: boolean;

  /**
   * Include linked automation wallets in result
   */
  includeWallets?: boolean;

  /**
   * Include quote token in result
   */
  includeQuoteToken?: boolean;
}
