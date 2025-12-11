/**
 * Strategy Manifest Type Definitions
 *
 * Manifests define deployable strategy contracts with their ABI, bytecode,
 * constructor parameters, capabilities, and user-configurable options.
 */

import type { AnyToken } from './token.js';

// =============================================================================
// CONSTRUCTOR PARAMETER TYPES
// =============================================================================

/**
 * Source of constructor parameter value
 *
 * - user-wallet: User's connected wallet address (typically the owner)
 * - automation-wallet: Newly generated automation wallet address
 * - user-input: User provides value via form input
 * - derived: Computed from other values or context
 */
export type ConstructorParamSource =
  | 'user-wallet'
  | 'automation-wallet'
  | 'user-input'
  | 'derived';

/**
 * Solidity types supported for constructor parameters
 */
export type SolidityType =
  | 'address'
  | 'uint256'
  | 'uint128'
  | 'uint64'
  | 'uint32'
  | 'uint16'
  | 'uint8'
  | 'int256'
  | 'bool'
  | 'bytes32'
  | 'string';

/**
 * Validation rules for constructor parameters
 */
export interface ConstructorParamValidation {
  /**
   * Minimum value (for uint/int types, as string for bigint compatibility)
   */
  min?: string;

  /**
   * Maximum value (for uint/int types, as string for bigint compatibility)
   */
  max?: string;

  /**
   * Regex pattern (for string/bytes types)
   */
  pattern?: string;
}

/**
 * Constructor parameter definition
 *
 * Describes a parameter passed to the strategy contract constructor.
 */
export interface ConstructorParam {
  /**
   * Parameter name from Solidity (e.g., "_owner", "_targetApr")
   */
  name: string;

  /**
   * Solidity type of the parameter
   */
  type: SolidityType;

  /**
   * Source of the parameter value
   */
  source: ConstructorParamSource;

  /**
   * UI label (for user-input parameters)
   * @example "Target APR (%)"
   */
  label?: string;

  /**
   * Help text describing the parameter
   */
  description?: string;

  /**
   * Whether the parameter is required (default: true for user-input)
   */
  required?: boolean;

  /**
   * Default value (as string for consistency)
   */
  default?: string;

  /**
   * Validation rules
   */
  validation?: ConstructorParamValidation;
}

// =============================================================================
// CAPABILITY TYPES
// =============================================================================

/**
 * Strategy capabilities (interfaces implemented by the contract)
 *
 * These flags indicate which interfaces the strategy contract implements,
 * enabling the UI to show relevant configuration options and features.
 */
export interface StrategyCapabilities {
  /**
   * Implements IFunding - Can receive deposits and process withdrawals
   */
  funding: boolean;

  /**
   * Implements IOhlcConsumer - Can subscribe to OHLC price feeds
   */
  ohlcConsumer: boolean;

  /**
   * Implements IPoolConsumer - Can receive pool state updates
   */
  poolConsumer: boolean;

  /**
   * Implements IBalanceConsumer - Can receive balance updates
   */
  balanceConsumer: boolean;

  /**
   * Implements IUniswapV3Actions - Can manage Uniswap V3 positions
   */
  uniswapV3Actions: boolean;
}

// =============================================================================
// USER PARAMETER TYPES (for strategy.config)
// =============================================================================

/**
 * Type of user-configurable parameter
 *
 * These parameters are stored in strategy.config after deployment
 * and can be modified without redeploying the contract.
 */
export type UserParamType =
  | 'number'
  | 'percentage'
  | 'token'
  | 'address'
  | 'boolean'
  | 'select';

/**
 * Option for select-type user parameters
 */
export interface UserParamOption {
  value: string;
  label: string;
}

/**
 * Validation rules for user parameters
 */
export interface UserParamValidation {
  /**
   * Minimum value (for number/percentage types)
   */
  min?: number;

  /**
   * Maximum value (for number/percentage types)
   */
  max?: number;

  /**
   * Step increment (for number/percentage types)
   */
  step?: number;

  /**
   * Regex pattern (for address/string types)
   */
  pattern?: string;
}

/**
 * User-configurable parameter definition
 *
 * Describes a parameter that users can configure when deploying
 * or modifying a strategy. Stored in strategy.config as JSON.
 */
export interface UserParam {
  /**
   * Key in strategy.config where this value is stored
   */
  name: string;

  /**
   * Type of the parameter (determines UI input)
   */
  type: UserParamType;

  /**
   * Display label in the UI
   */
  label: string;

  /**
   * Help text describing the parameter
   */
  description: string;

  /**
   * Whether the parameter must be provided
   */
  required: boolean;

  /**
   * Default value
   */
  default?: unknown;

  /**
   * Available options (for 'select' type only)
   */
  options?: UserParamOption[];

  /**
   * Validation rules
   */
  validation?: UserParamValidation;
}

// =============================================================================
// STRATEGY MANIFEST
// =============================================================================

/**
 * Strategy Manifest
 *
 * Complete definition for a deployable strategy contract, including:
 * - Contract artifacts (ABI, bytecode)
 * - Constructor parameters and their sources
 * - Capability flags for UI feature gating
 * - User-configurable parameters for strategy.config
 * - Metadata for display and organization
 */
export interface StrategyManifest {
  // ============================================================================
  // DATABASE FIELDS
  // ============================================================================

  /**
   * Unique identifier (database-generated cuid)
   */
  id: string;

  /**
   * Creation timestamp
   */
  createdAt: Date;

  /**
   * Last update timestamp
   */
  updatedAt: Date;

  // ============================================================================
  // IDENTIFICATION
  // ============================================================================

  /**
   * URL-friendly unique identifier
   * @example "funding-example-v1", "delta-neutral-v1"
   */
  slug: string;

  /**
   * Semantic version of the manifest/contract
   * @example "1.0.0"
   */
  version: string;

  /**
   * Human-readable display name
   * @example "Funding Example Strategy"
   */
  name: string;

  /**
   * Detailed description (supports markdown)
   */
  description: string;

  // ============================================================================
  // CONTRACT ARTIFACTS
  // ============================================================================

  /**
   * Full ABI array (viem-compatible)
   * Used for contract deployment and interaction
   */
  abi: unknown[];

  /**
   * Compiled bytecode (0x prefixed)
   * Used for contract deployment
   */
  bytecode: string;

  // ============================================================================
  // PARAMETERS
  // ============================================================================

  /**
   * Constructor parameter definitions
   * Ordered as they appear in the contract constructor
   */
  constructorParams: ConstructorParam[];

  /**
   * User-configurable parameters
   * Stored in strategy.config after deployment
   */
  userParams: UserParam[];

  // ============================================================================
  // CAPABILITIES
  // ============================================================================

  /**
   * Capability flags indicating implemented interfaces
   */
  capabilities: StrategyCapabilities;

  // ============================================================================
  // BASIC CURRENCY
  // ============================================================================

  /**
   * Basic currency ID for metrics aggregation
   * All positions in strategies using this manifest should use
   * quote tokens linked to this basic currency.
   */
  basicCurrencyId: string;

  /**
   * Basic currency token (populated when included in query)
   */
  basicCurrency?: AnyToken;

  // ============================================================================
  // STATUS
  // ============================================================================

  /**
   * Whether this manifest is available for new deployments
   */
  isActive: boolean;

  /**
   * Whether the contract has been audited
   */
  isAudited: boolean;

  // ============================================================================
  // METADATA
  // ============================================================================

  /**
   * Author or organization name
   */
  author?: string;

  /**
   * Link to source code repository
   */
  repository?: string;

  /**
   * Tags for filtering and categorization
   * @example ["funding", "example", "beginner"]
   */
  tags: string[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates empty/default capabilities object
 */
export function createEmptyCapabilities(): StrategyCapabilities {
  return {
    funding: false,
    ohlcConsumer: false,
    poolConsumer: false,
    balanceConsumer: false,
    uniswapV3Actions: false,
  };
}

/**
 * Checks if a manifest has funding capability
 */
export function hasFundingCapability(manifest: StrategyManifest): boolean {
  return manifest.capabilities.funding;
}

/**
 * Gets constructor params that require user input
 */
export function getUserInputParams(manifest: StrategyManifest): ConstructorParam[] {
  return manifest.constructorParams.filter((p) => p.source === 'user-input');
}

/**
 * Checks if manifest has any user-input constructor params
 */
export function hasUserInputParams(manifest: StrategyManifest): boolean {
  return getUserInputParams(manifest).length > 0;
}

/**
 * Checks if manifest has any user-configurable params
 */
export function hasUserParams(manifest: StrategyManifest): boolean {
  return manifest.userParams.length > 0;
}
