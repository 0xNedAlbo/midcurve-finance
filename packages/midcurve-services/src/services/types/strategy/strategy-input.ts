/**
 * Strategy Input Types
 *
 * Input types for Strategy CRUD operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

import type { StrategyStatus, StrategyConfig, StrategyManifest } from '@midcurve/shared';

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
   * Quote token ID (required)
   * All metrics for this strategy will be denominated in this token.
   */
  quoteTokenId: string;

  /**
   * Embedded manifest (optional)
   * Contains ABI, bytecode, and constructor parameter definitions.
   * Stored directly on the strategy record.
   */
  manifest?: StrategyManifest;

  /**
   * Automation wallet info (optional)
   * If provided, creates an AutomationWallet record linked to this strategy.
   * Created by the signer service during deployment.
   */
  automationWallet?: {
    walletAddress: string;
    kmsKeyId: string;
  };
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
  status?: StrategyStatus | StrategyStatus[];

  /**
   * Filter by strategy type
   */
  strategyType?: string;

  /**
   * Include linked automation wallets in result
   */
  includeWallets?: boolean;

  /**
   * Include quote token in result
   */
  includeQuoteToken?: boolean;
}
