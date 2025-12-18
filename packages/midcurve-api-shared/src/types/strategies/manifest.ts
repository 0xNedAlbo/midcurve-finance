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
// MANIFEST SCHEMA
// =============================================================================

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

  // Metadata
  tags: z.array(z.string()).optional(),
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
  | 'INVALID_FIELD_VALUE';

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

  /**
   * Quote token ID for metrics denomination
   * All position metrics will be in this token
   */
  quoteTokenId: string;
}

/**
 * Zod schema for deploy strategy request
 */
export const DeployStrategyRequestSchema = z.object({
  manifest: StrategyManifestSchema,
  name: z.string().min(1).max(100),
  constructorValues: z.record(z.string()),
  quoteTokenId: z.string().min(1),
});

/**
 * Deployment status
 */
export type DeploymentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

/**
 * Deployment information in response
 */
export interface DeploymentInfo {
  /**
   * Current deployment status
   */
  status: DeploymentStatus;

  /**
   * Transaction hash (after submission)
   */
  transactionHash?: string;

  /**
   * Contract address (after confirmation)
   */
  contractAddress?: string;

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
 */
export interface DeployStrategyResponse {
  /**
   * Created strategy record
   */
  strategy: SerializedStrategy;

  /**
   * Newly created automation wallet
   */
  automationWallet: DeployAutomationWalletInfo;

  /**
   * Deployment status and info
   */
  deployment: DeploymentInfo;
}

/**
 * API response wrapper for deploy strategy
 */
export type DeployStrategyApiResponse = ApiResponse<DeployStrategyResponse>;
