/**
 * Strategy Manifest API Types
 *
 * Types and schemas for strategy manifest operations:
 * - POST /api/v1/strategies/verify-manifest - Validate uploaded manifest
 * - POST /api/v1/strategies/deploy - Deploy strategy from manifest
 */

import type { ApiResponse, BigIntToString } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import type { StrategyManifest } from '@midcurve/shared';
import { z } from 'zod';

// =============================================================================
// SERIALIZED TYPES
// =============================================================================

/**
 * Serialized strategy manifest for API responses
 *
 * All Date fields converted to strings for JSON serialization.
 * Note: StrategyManifest no longer has Date fields, so this is mostly
 * for type consistency.
 */
export type SerializedStrategyManifest = BigIntToString<StrategyManifest>;

// =============================================================================
// CONSTRUCTOR PARAM SCHEMAS
// =============================================================================

/**
 * Zod schema for constructor parameter source
 *
 * - operator-address: Per-strategy automation wallet (KMS-backed, executes step())
 * - core-address: Core orchestrator address (funds GC operations)
 * - user-input: User provides value via form input
 */
export const ConstructorParamSourceSchema = z.enum([
  'operator-address',
  'core-address',
  'user-input',
]);

/**
 * Zod schema for Solidity types
 */
export const SolidityTypeSchema = z.enum([
  'address',
  'uint256',
  'uint128',
  'uint64',
  'uint32',
  'uint16',
  'uint8',
  'int256',
  'bool',
  'bytes32',
  'string',
]);

/**
 * Zod schema for UI element types for constructor parameters
 */
export const ParamUIElementSchema = z.enum([
  'text',
  'bigint',
  'number',
  'evm-address',
  'boolean',
  'hidden',
]);

/**
 * Zod schema for layout UI element types
 */
export const LayoutUIElementSchema = z.enum(['section', 'separator']);

/**
 * Zod schema for constructor parameter UI configuration
 */
export const ConstructorParamUISchema = z.object({
  element: ParamUIElementSchema,
  label: z.string().min(1),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  required: z.boolean().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
  step: z.string().optional(),
  decimals: z.number().int().min(0).optional(),
  pattern: z.string().optional(),
});

/**
 * Zod schema for constructor parameter
 */
export const ConstructorParamSchema = z.object({
  name: z.string().min(1),
  type: SolidityTypeSchema,
  source: ConstructorParamSourceSchema,
  ui: ConstructorParamUISchema.optional(),
});

/**
 * Zod schema for layout element
 */
export const LayoutElementSchema = z.object({
  element: LayoutUIElementSchema,
  title: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Zod schema for form item (param or layout)
 */
export const FormItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('param'),
    param: ConstructorParamSchema,
  }),
  z.object({
    type: z.literal('layout'),
    layout: LayoutElementSchema,
  }),
]);

// =============================================================================
// QUOTE TOKEN SCHEMA
// =============================================================================

/**
 * Zod schema for basic currency quote token
 */
export const ManifestQuoteTokenBasicCurrencySchema = z.object({
  type: z.literal('basic-currency'),
  symbol: z.string().min(1).max(10),
});

/**
 * Zod schema for ERC-20 quote token
 */
export const ManifestQuoteTokenErc20Schema = z.object({
  type: z.literal('erc20'),
  symbol: z.string().min(1).max(20),
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address format'),
});

/**
 * Zod schema for manifest quote token (discriminated union)
 *
 * Supports both basic currencies (USD, ETH, BTC) and ERC-20 tokens.
 * Both types require a symbol for manifest readability.
 * - basic-currency: Symbol will be validated against CoinGecko supported currencies
 * - erc20: Symbol will be validated against on-chain token symbol (case-sensitive!)
 */
export const ManifestQuoteTokenSchema = z.discriminatedUnion('type', [
  ManifestQuoteTokenBasicCurrencySchema,
  ManifestQuoteTokenErc20Schema,
]);

// =============================================================================
// MANIFEST SCHEMA
// =============================================================================

/**
 * Zod schema for log topics
 *
 * Maps topic names to human-readable descriptions.
 * Topic names should be uppercase identifiers (e.g., "POSITION_OPENED").
 */
export const LogTopicsSchema = z.record(
  z.string().min(1).max(50).regex(/^[A-Z][A-Z0-9_]*$/, 'Topic name must be uppercase identifier'),
  z.string().min(1).max(500)
);

/**
 * Zod schema for user-uploaded strategy manifest
 */
export const StrategyManifestSchema = z.object({
  // Identification
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format'),
  description: z.string().optional(),
  author: z.string().optional(),

  // Contract artifacts
  abi: z.array(z.unknown()).min(1),
  bytecode: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, 'Bytecode must be hex string'),

  // Parameters
  constructorParams: z.array(ConstructorParamSchema),
  formLayout: z.array(FormItemSchema).optional(),

  // Quote token for strategy metrics valuation
  quoteToken: ManifestQuoteTokenSchema,

  // Metadata
  tags: z.array(z.string()).optional(),

  // Logging
  logTopics: LogTopicsSchema.optional(),
});

// =============================================================================
// VERIFY MANIFEST
// =============================================================================

/**
 * Error/warning codes for manifest verification
 */
export type ManifestErrorCode =
  | 'INVALID_JSON'
  | 'SCHEMA_ERROR'
  | 'INVALID_ABI'
  | 'NO_CONSTRUCTOR'
  | 'PARAM_COUNT_MISMATCH'
  | 'PARAM_TYPE_MISMATCH'
  | 'PARAM_ORDER_MISMATCH'
  | 'MISSING_UI_CONFIG'
  | 'INVALID_BYTECODE'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_FIELD_VALUE'
  | 'INVALID_QUOTE_TOKEN'
  | 'QUOTE_TOKEN_SYMBOL_MISMATCH';

/**
 * Severity level for verification issues
 */
export type VerificationSeverity = 'error' | 'warning';

/**
 * A verification issue (error or warning)
 */
export interface ManifestIssue {
  severity: VerificationSeverity;
  code: ManifestErrorCode;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

/**
 * Request body for verify manifest endpoint
 */
export interface VerifyManifestRequest {
  /**
   * The manifest JSON to verify
   */
  manifest: unknown;
}

/**
 * Zod schema for verify manifest request
 */
export const VerifyManifestRequestSchema = z.object({
  manifest: z.unknown(),
});

/**
 * Response for verify manifest endpoint
 */
export interface VerifyManifestResponse {
  /**
   * Whether the manifest is valid for deployment
   */
  valid: boolean;

  /**
   * List of errors that prevent deployment
   */
  errors: ManifestIssue[];

  /**
   * List of warnings (non-blocking)
   */
  warnings: ManifestIssue[];

  /**
   * Parsed manifest (if valid)
   */
  parsedManifest?: SerializedStrategyManifest;

  /**
   * Database ID of the resolved quote token (if valid)
   *
   * The verification process finds or creates the quote token in the database
   * based on the manifest's quoteToken field. This ID is used during deployment.
   */
  resolvedQuoteTokenId?: string;
}

/**
 * API response wrapper for verify manifest
 */
export type VerifyManifestApiResponse = ApiResponse<VerifyManifestResponse>;

// =============================================================================
// DEPLOY STRATEGY
// =============================================================================

/**
 * Request body for deploy strategy endpoint
 *
 * Now takes a full manifest instead of manifestSlug, since manifests
 * are user-uploaded rather than selected from a database catalogue.
 *
 * Note: quoteTokenId is NOT included in the request. The quote token is
 * resolved during manifest verification (from manifest.quoteToken) and
 * stored in the VerifyManifestResponse. The deploy endpoint re-verifies
 * the manifest and resolves the quote token server-side.
 */
export interface DeployStrategyRequest {
  /**
   * The validated manifest to deploy
   */
  manifest: StrategyManifest;

  /**
   * User-provided name for this strategy instance
   */
  name: string;

  /**
   * Values for user-input constructor parameters
   * Key is param name, value is string representation
   */
  constructorValues: Record<string, string>;
}

/**
 * Zod schema for deploy strategy request
 */
export const DeployStrategyRequestSchema = z.object({
  manifest: StrategyManifestSchema,
  name: z.string().min(1).max(100),
  constructorValues: z.record(z.string()),
});

/**
 * Deployment status
 *
 * Extended to support async deployment flow from EVM service:
 * - pending: Deployment initiated
 * - signing: Signer service is signing the transaction
 * - broadcasting: Transaction is being broadcast to the network
 * - confirming: Waiting for transaction confirmation
 * - setting_up_topology: Setting up RabbitMQ topology for the strategy
 * - completed: Deployment finished successfully
 * - failed: Deployment failed
 */
export type DeploymentStatus =
  | 'pending'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'setting_up_topology'
  | 'completed'
  | 'failed';

/**
 * Deployment information in response
 */
export interface DeploymentInfo {
  /**
   * Current deployment status
   */
  status: DeploymentStatus;

  /**
   * Transaction hash (after signing/broadcasting)
   */
  transactionHash?: string;

  /**
   * Contract address (predicted during signing, confirmed after completion)
   */
  contractAddress?: string;

  /**
   * URL to poll for deployment status updates
   * Returned for async deployments (status 202)
   */
  pollUrl?: string;

  /**
   * Error message (if failed)
   */
  error?: string;
}

/**
 * Automation wallet info in deploy response
 */
export interface DeployAutomationWalletInfo {
  /**
   * Database ID of the automation wallet
   */
  id: string;

  /**
   * Ethereum address of the automation wallet
   */
  address: string;
}

/**
 * Response for deploy strategy endpoint
 *
 * With async deployment (202 Accepted):
 * - Strategy is NOT created upfront - only after deployment succeeds
 * - Poll the pollUrl to check deployment status
 * - Strategy will be returned when deployment completes
 *
 * This prevents orphan "deploying" strategies from failed deployments.
 */
export interface DeployStrategyResponse {
  /**
   * Strategy record
   * Optional: Not available until deployment completes successfully
   * Poll the deployment.pollUrl to check status
   */
  strategy?: SerializedStrategy;

  /**
   * Newly created automation wallet
   * Optional: Not available until deployment completes
   */
  automationWallet?: DeployAutomationWalletInfo;

  /**
   * Deployment status and info
   */
  deployment: DeploymentInfo;
}

/**
 * API response wrapper for deploy strategy
 */
export type DeployStrategyApiResponse = ApiResponse<DeployStrategyResponse>;
