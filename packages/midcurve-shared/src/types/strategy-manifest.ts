/**
 * Strategy Manifest Type Definitions
 *
 * Manifests define deployable strategy contracts with their ABI, bytecode,
 * and constructor parameters. These are user-uploaded JSON files that
 * contain everything needed to deploy a strategy contract.
 */

// =============================================================================
// CONSTRUCTOR PARAMETER TYPES
// =============================================================================

/**
 * Source of constructor parameter value
 *
 * - operator-address: Per-strategy automation wallet (KMS-backed, executes step())
 * - core-address: Core orchestrator address (funds GC operations, from CORE_ADDRESS env)
 * - user-input: User provides value via form input
 */
export type ConstructorParamSource =
  | 'operator-address'
  | 'core-address'
  | 'user-input';

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

// =============================================================================
// UI ELEMENT TYPES
// =============================================================================

/**
 * UI element types for constructor parameter inputs
 * These map to actual constructor parameters
 */
export type ParamUIElement =
  | 'text' // Free-form text input (string, bytes32)
  | 'bigint' // Large integer input for uint256/int256 (stored as string)
  | 'number' // Decimal number input (percentages, fractional ETH)
  | 'evm-address' // EVM address with EIP-55 checksum validation
  | 'boolean' // Toggle switch
  | 'hidden'; // Not shown in UI (operator/core addresses)

/**
 * UI layout element types (not mapped to constructor params)
 * Used for visual organization of the form
 */
export type LayoutUIElement =
  | 'section' // Section heading with optional description
  | 'separator'; // Visual divider between groups

/**
 * UI configuration for a constructor parameter
 * Required for user-input params, ignored for others
 */
export interface ConstructorParamUI {
  /**
   * UI element type to render
   */
  element: ParamUIElement;

  /**
   * Display label for the field
   * @example "Target APR (%)"
   */
  label: string;

  /**
   * Help text describing the parameter
   */
  description?: string;

  /**
   * Placeholder text shown in empty input
   */
  placeholder?: string;

  /**
   * Default value (as string for consistency)
   */
  default?: string;

  /**
   * Whether the parameter is required
   * @default true
   */
  required?: boolean;

  /**
   * Minimum value (for bigint or number types, as string)
   */
  min?: string;

  /**
   * Maximum value (for bigint or number types, as string)
   */
  max?: string;

  /**
   * Step value for number inputs (e.g., "0.01" for percentages)
   */
  step?: string;

  /**
   * Decimal places for number inputs
   * Used to convert user decimal input to bigint on submit
   * @example 2 means "5.5" → "550" (multiply by 100)
   */
  decimals?: number;

  /**
   * Regex pattern for text inputs
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
   * UI configuration (required for user-input params)
   */
  ui?: ConstructorParamUI;
}

// =============================================================================
// LAYOUT ELEMENTS
// =============================================================================

/**
 * Layout element for visual organization (not a constructor param)
 */
export interface LayoutElement {
  /**
   * Layout element type
   */
  element: LayoutUIElement;

  /**
   * Section title (for 'section' elements)
   */
  title?: string;

  /**
   * Section description (for 'section' elements)
   */
  description?: string;
}

/**
 * Form item - either a constructor param or layout element
 * Used in formLayout array for rich form organization
 */
export type FormItem =
  | { type: 'param'; param: ConstructorParam }
  | { type: 'layout'; layout: LayoutElement };

// =============================================================================
// QUOTE TOKEN TYPES
// =============================================================================

/**
 * Quote token reference for basic currency (platform-agnostic)
 *
 * Used for strategies that measure value in abstract currencies like USD, ETH, or BTC.
 * Symbol will be validated against CoinGecko supported_vs_currencies during verification.
 */
export interface ManifestQuoteTokenBasicCurrency {
  type: 'basic-currency';

  /**
   * Currency symbol (will be normalized to uppercase)
   * @example 'USD', 'ETH', 'BTC'
   */
  symbol: string;
}

/**
 * Quote token reference for ERC-20 token (EVM chain-specific)
 *
 * Used for strategies that measure value in a specific on-chain token.
 * Symbol will be validated against on-chain contract data during verification.
 * Symbol matching is case-sensitive (e.g., "stETH" not "STETH").
 */
export interface ManifestQuoteTokenErc20 {
  type: 'erc20';

  /**
   * Token symbol (case-sensitive, must match on-chain)
   * @example 'USDC', 'stETH', 'WETH'
   */
  symbol: string;

  /**
   * EVM chain ID
   * @example 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Token contract address (will be normalized to EIP-55)
   * @example '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   */
  address: string;
}

/**
 * Quote token reference in manifest (discriminated union)
 *
 * Specifies the token used for strategy metrics valuation.
 * Both types include a symbol field for manifest readability.
 */
export type ManifestQuoteToken =
  | ManifestQuoteTokenBasicCurrency
  | ManifestQuoteTokenErc20;

// =============================================================================
// STRATEGY MANIFEST
// =============================================================================

/**
 * Strategy Manifest
 *
 * User-uploaded JSON file containing everything needed to deploy a strategy contract.
 * This is NOT a database model - it's the structure of uploaded manifest files.
 *
 * Key design:
 * - No database fields (id, createdAt, etc.) - those are on Strategy model
 * - Embedded in Strategy.manifest JSON field after upload
 * - Validated by ManifestVerificationService before storage
 */
export interface StrategyManifest {
  // ============================================================================
  // IDENTIFICATION
  // ============================================================================

  /**
   * Human-readable display name
   * @example "Funding Example Strategy"
   */
  name: string;

  /**
   * Semantic version of the manifest/contract
   * @example "1.0.0"
   */
  version: string;

  /**
   * Detailed description (supports markdown)
   */
  description?: string;

  /**
   * Author or organization name
   */
  author?: string;

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
  bytecode: `0x${string}`;

  // ============================================================================
  // PARAMETERS
  // ============================================================================

  /**
   * Constructor parameter definitions
   * Ordered as they appear in the contract constructor
   */
  constructorParams: ConstructorParam[];

  /**
   * Optional form layout with sections and separators
   * If not provided, params are rendered in order without grouping
   */
  formLayout?: FormItem[];

  // ============================================================================
  // QUOTE TOKEN
  // ============================================================================

  /**
   * Quote token for strategy metrics valuation
   *
   * All position values, PnL, and fees will be denominated in this token.
   * Can be either a basic currency (USD, ETH, BTC) or an ERC-20 token.
   *
   * @example { type: 'basic-currency', symbol: 'USD' }
   * @example { type: 'erc20', symbol: 'USDC', chainId: 42161, address: '0x...' }
   */
  quoteToken: ManifestQuoteToken;

  // ============================================================================
  // METADATA
  // ============================================================================

  /**
   * Tags for filtering and categorization
   * @example ["funding", "example", "beginner"]
   */
  tags?: string[];

  // ============================================================================
  // LOGGING
  // ============================================================================

  /**
   * Custom log topics defined by the strategy
   *
   * Maps topic names to human-readable descriptions. The keccak256 hash
   * of each topic name is computed at runtime for log decoding.
   *
   * Strategy developers can use these topics in their _log*() calls:
   * ```solidity
   * _logInfo(keccak256("POSITION_OPENED"), "Opened new position at tick -100");
   * ```
   *
   * @example
   * {
   *   "POSITION_OPENED": "Logged when a new liquidity position is opened",
   *   "REBALANCE_TRIGGERED": "Logged when price crosses rebalance threshold",
   *   "FEE_COLLECTED": "Logged when fees are collected from the position"
   * }
   */
  logTopics?: Record<string, string>;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Gets constructor params that require user input
 */
export function getUserInputParams(
  manifest: StrategyManifest
): ConstructorParam[] {
  return manifest.constructorParams.filter((p) => p.source === 'user-input');
}

/**
 * Checks if manifest has any user-input constructor params
 */
export function hasUserInputParams(manifest: StrategyManifest): boolean {
  return getUserInputParams(manifest).length > 0;
}

/**
 * Gets the default UI element for a Solidity type
 */
export function getDefaultUIElement(solidityType: SolidityType): ParamUIElement {
  switch (solidityType) {
    case 'address':
      return 'evm-address';
    case 'bool':
      return 'boolean';
    case 'string':
    case 'bytes32':
      return 'text';
    case 'uint256':
    case 'uint128':
    case 'uint64':
    case 'uint32':
    case 'uint16':
    case 'uint8':
    case 'int256':
      return 'bigint';
    default:
      return 'text';
  }
}
