/**
 * Strategy Manifest Types
 *
 * Type definitions for strategy manifests that define contract deployment
 * and configuration. Manifests are stored as JSON in the database.
 */

import type { Abi, Address, Hex } from 'viem';

// =============================================================================
// Constructor Parameter Types
// =============================================================================

/**
 * Source of constructor parameter value
 * - 'operator-address': Auto-filled with strategy's automation wallet address
 * - 'core-address': Auto-filled with core orchestrator address
 * - 'user-input': Provided by user during strategy creation
 */
export type ConstructorParamSource = 'operator-address' | 'core-address' | 'user-input';

/**
 * UI configuration for constructor parameter
 */
export interface ConstructorParamUi {
  element: 'hidden' | 'text' | 'number' | 'address' | 'select';
  label: string;
  description?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

/**
 * Constructor parameter definition from manifest
 */
export interface ConstructorParam {
  name: string;
  type: string;
  source: ConstructorParamSource;
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
  ui?: ConstructorParamUi;
}

// =============================================================================
// Funding Token Types
// =============================================================================

/**
 * Funding token specification
 * Defines the ERC20 token used for vault funding
 */
export interface FundingTokenSpec {
  /** Token type - currently only 'erc20' supported */
  type: 'erc20';
  /** Public chain ID (1 = Ethereum, 42161 = Arbitrum, etc.) - NOT 31337 (SEMSEE) */
  chainId: number;
  /** ERC20 token address (EIP-55 checksummed) */
  address: Address;
}

// =============================================================================
// Quote Token Types
// =============================================================================

/**
 * Quote token specification for strategy metrics
 */
export type QuoteTokenSpec =
  | { type: 'basic-currency'; symbol: string }
  | { type: 'erc20'; chainId: number; address: Address };

// =============================================================================
// Strategy Manifest
// =============================================================================

/**
 * Full strategy manifest definition
 * Stored as JSON in the database, loaded during deployment
 */
export interface StrategyManifest {
  /** Strategy name */
  name: string;
  /** Semantic version */
  version: string;
  /** Strategy description */
  description?: string;
  /** Author name or organization */
  author?: string;
  /** Contract ABI */
  abi: Abi;
  /** Contract bytecode (hex string) */
  bytecode: Hex;
  /** Constructor parameters with sources and UI config */
  constructorParams: ConstructorParam[];
  /** Tags for categorization */
  tags?: string[];
  /** Quote token for metrics */
  quoteToken: QuoteTokenSpec;
  /** Funding token for vault (optional - only if strategy uses FundingMixin) */
  fundingToken?: FundingTokenSpec;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a funding token spec
 * @throws Error if invalid
 */
export function validateFundingTokenSpec(spec: unknown): asserts spec is FundingTokenSpec {
  if (!spec || typeof spec !== 'object') {
    throw new Error('fundingToken must be an object');
  }

  const s = spec as Record<string, unknown>;

  if (s.type !== 'erc20') {
    throw new Error(`Invalid fundingToken type: ${s.type}. Only 'erc20' is supported.`);
  }

  if (typeof s.chainId !== 'number' || s.chainId <= 0) {
    throw new Error(`Invalid fundingToken chainId: ${s.chainId}`);
  }

  // Reject SEMSEE chain - funding token must be on public chain
  if (s.chainId === 31337) {
    throw new Error('fundingToken chainId cannot be 31337 (SEMSEE). Use a public chain.');
  }

  if (typeof s.address !== 'string' || !s.address.startsWith('0x')) {
    throw new Error(`Invalid fundingToken address: ${s.address}`);
  }
}

/**
 * Check if manifest requires vault funding
 */
export function requiresVaultFunding(manifest: StrategyManifest): boolean {
  return manifest.fundingToken !== undefined;
}
