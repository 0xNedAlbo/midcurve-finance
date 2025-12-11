/**
 * Strategy Manifest API Types
 *
 * Types and schemas for strategy manifest endpoints:
 * - GET /api/v1/strategies/manifests - List available manifests
 * - GET /api/v1/strategies/manifests/:slug - Get specific manifest
 * - POST /api/v1/strategies/deploy - Deploy strategy from manifest
 */

import type { ApiResponse, BigIntToString } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import type { StrategyManifest, StrategyCapabilities } from '@midcurve/shared';
import { z } from 'zod';

// =============================================================================
// SERIALIZED TYPES
// =============================================================================

/**
 * Serialized strategy manifest for API responses
 *
 * All Date fields converted to strings for JSON serialization.
 */
export type SerializedStrategyManifest = BigIntToString<StrategyManifest>;

// =============================================================================
// CONSTRUCTOR PARAM SCHEMAS
// =============================================================================

/**
 * Zod schema for constructor parameter source
 */
export const ConstructorParamSourceSchema = z.enum([
  'user-wallet',
  'automation-wallet',
  'user-input',
  'derived',
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
 * Zod schema for constructor parameter validation
 */
export const ConstructorParamValidationSchema = z.object({
  min: z.string().optional(),
  max: z.string().optional(),
  pattern: z.string().optional(),
});

/**
 * Zod schema for constructor parameter
 */
export const ConstructorParamSchema = z.object({
  name: z.string().min(1),
  type: SolidityTypeSchema,
  source: ConstructorParamSourceSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  validation: ConstructorParamValidationSchema.optional(),
});

// =============================================================================
// CAPABILITY SCHEMAS
// =============================================================================

/**
 * Zod schema for strategy capabilities
 */
export const StrategyCapabilitiesSchema = z.object({
  funding: z.boolean(),
  ohlcConsumer: z.boolean(),
  poolConsumer: z.boolean(),
  balanceConsumer: z.boolean(),
  uniswapV3Actions: z.boolean(),
});

// =============================================================================
// USER PARAM SCHEMAS
// =============================================================================

/**
 * Zod schema for user parameter type
 */
export const UserParamTypeSchema = z.enum([
  'number',
  'percentage',
  'token',
  'address',
  'boolean',
  'select',
]);

/**
 * Zod schema for user parameter option
 */
export const UserParamOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

/**
 * Zod schema for user parameter validation
 */
export const UserParamValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  pattern: z.string().optional(),
});

/**
 * Zod schema for user parameter
 */
export const UserParamSchema = z.object({
  name: z.string().min(1),
  type: UserParamTypeSchema,
  label: z.string().min(1),
  description: z.string(),
  required: z.boolean(),
  default: z.unknown().optional(),
  options: z.array(UserParamOptionSchema).optional(),
  validation: UserParamValidationSchema.optional(),
});

// =============================================================================
// LIST MANIFESTS
// =============================================================================

/**
 * Query parameters for listing manifests
 */
export interface ListManifestsQuery {
  /**
   * Filter by active status (default: true)
   */
  isActive?: boolean;

  /**
   * Filter by basic currency ID
   */
  basicCurrencyId?: string;

  /**
   * Filter by tags (OR logic - matches if any tag present)
   */
  tags?: string[];

  /**
   * Include basic currency token in response
   */
  includeBasicCurrency?: boolean;
}

/**
 * Zod schema for list manifests query
 */
export const ListManifestsQuerySchema = z.object({
  isActive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  basicCurrencyId: z.string().optional(),
  tags: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .optional(),
  includeBasicCurrency: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
});

/**
 * Response for list manifests endpoint
 */
export interface ListManifestsResponse {
  manifests: SerializedStrategyManifest[];
}

/**
 * API response wrapper for list manifests
 */
export type ListManifestsApiResponse = ApiResponse<ListManifestsResponse>;

// =============================================================================
// GET MANIFEST
// =============================================================================

/**
 * Path parameters for get manifest endpoint
 */
export interface GetManifestParams {
  slug: string;
}

/**
 * Zod schema for get manifest params
 */
export const GetManifestParamsSchema = z.object({
  slug: z.string().min(1),
});

/**
 * Query parameters for get manifest endpoint
 */
export interface GetManifestQuery {
  /**
   * Include basic currency token in response
   */
  includeBasicCurrency?: boolean;
}

/**
 * Zod schema for get manifest query
 */
export const GetManifestQuerySchema = z.object({
  includeBasicCurrency: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
});

/**
 * Response for get manifest endpoint
 */
export interface GetManifestResponse {
  manifest: SerializedStrategyManifest;
}

/**
 * API response wrapper for get manifest
 */
export type GetManifestApiResponse = ApiResponse<GetManifestResponse>;

// =============================================================================
// DEPLOY STRATEGY
// =============================================================================

/**
 * Request body for deploy strategy endpoint
 */
export interface DeployStrategyRequest {
  /**
   * Slug of the manifest to deploy
   */
  manifestSlug: string;

  /**
   * User-provided name for this strategy instance
   */
  name: string;

  /**
   * Values for user-input constructor parameters
   * Key is param name, value is string representation
   */
  constructorValues?: Record<string, string>;

  /**
   * Initial strategy.config values
   * Key is userParam name, value is the configured value
   */
  config?: Record<string, unknown>;
}

/**
 * Zod schema for deploy strategy request
 */
export const DeployStrategyRequestSchema = z.object({
  manifestSlug: z.string().min(1),
  name: z.string().min(1).max(100),
  constructorValues: z.record(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
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

// =============================================================================
// CREATE MANIFEST (Admin)
// =============================================================================

/**
 * Request body for creating a manifest (admin endpoint)
 */
export interface CreateManifestRequest {
  slug: string;
  version: string;
  name: string;
  description: string;
  abi: unknown[];
  bytecode: string;
  constructorParams: z.infer<typeof ConstructorParamSchema>[];
  capabilities: StrategyCapabilities;
  basicCurrencyId: string;
  userParams: z.infer<typeof UserParamSchema>[];
  isActive?: boolean;
  isAudited?: boolean;
  author?: string;
  repository?: string;
  tags?: string[];
}

/**
 * Zod schema for create manifest request
 */
export const CreateManifestRequestSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format'),
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  abi: z.array(z.unknown()).min(1),
  bytecode: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Bytecode must be hex string'),
  constructorParams: z.array(ConstructorParamSchema),
  capabilities: StrategyCapabilitiesSchema,
  basicCurrencyId: z.string().min(1),
  userParams: z.array(UserParamSchema),
  isActive: z.boolean().optional().default(true),
  isAudited: z.boolean().optional().default(false),
  author: z.string().optional(),
  repository: z.string().url().optional(),
  tags: z.array(z.string()).optional().default([]),
});

/**
 * Response for create manifest endpoint
 */
export interface CreateManifestResponse {
  manifest: SerializedStrategyManifest;
}

/**
 * API response wrapper for create manifest
 */
export type CreateManifestApiResponse = ApiResponse<CreateManifestResponse>;
