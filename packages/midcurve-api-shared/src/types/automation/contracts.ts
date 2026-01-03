/**
 * Automation Contract Endpoint Types
 *
 * Types for managing automation contracts (deploy, list, get).
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Contract type discriminator values
 */
export const CONTRACT_TYPES = ['uniswapv3'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/**
 * Serialized automation contract for API responses
 */
export interface SerializedAutomationContract {
  id: string;
  contractType: ContractType;
  userId: string;
  isActive: boolean;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialized UniswapV3 contract config (for typed responses)
 */
export interface SerializedUniswapV3ContractConfig {
  chainId: number;
  contractAddress: string;
  nfpmAddress: string;
  operatorAddress: string;
}

/**
 * Serialized UniswapV3 contract state (for typed responses)
 */
export interface SerializedUniswapV3ContractState {
  deploymentTxHash: string | null;
  deployedAt: string | null;
  lastCloseId: number;
}

// =============================================================================
// DEPLOY CONTRACT
// =============================================================================

/**
 * POST /api/v1/automation/contracts - Request body
 *
 * Deploy a new automation contract for the user on a specific chain.
 */
export interface DeployContractRequest {
  /**
   * Contract type to deploy
   */
  contractType: ContractType;

  /**
   * Chain ID to deploy on
   * @example 1, 42161, 8453
   */
  chainId: number;
}

/**
 * Zod schema for deploy contract request
 */
export const DeployContractRequestSchema = z.object({
  contractType: z.enum(CONTRACT_TYPES, {
    errorMap: () => ({ message: `Contract type must be one of: ${CONTRACT_TYPES.join(', ')}` }),
  }),

  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
});

/**
 * Inferred type from schema
 */
export type DeployContractInput = z.infer<typeof DeployContractRequestSchema>;

/**
 * Deploy contract response (async operation - returns 202)
 */
export interface DeployContractResponseData {
  /**
   * Contract record ID
   */
  id: string;

  /**
   * Contract type
   */
  contractType: ContractType;

  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Operation status
   */
  operationStatus: 'pending' | 'deploying' | 'completed' | 'failed';

  /**
   * URL to poll for status
   */
  pollUrl: string;
}

/**
 * POST /api/v1/automation/contracts - Response
 */
export type DeployContractResponse = ApiResponse<DeployContractResponseData>;

// =============================================================================
// LIST CONTRACTS
// =============================================================================

/**
 * GET /api/v1/automation/contracts - Query parameters
 */
export interface ListContractsRequest {
  /**
   * Filter by contract type (optional)
   */
  contractType?: ContractType;

  /**
   * Filter by chain ID (optional)
   */
  chainId?: number;

  /**
   * Filter by active status (optional)
   */
  isActive?: boolean;
}

/**
 * Zod schema for list contracts query
 */
export const ListContractsQuerySchema = z.object({
  contractType: z.enum(CONTRACT_TYPES).optional(),
  chainId: z.coerce.number().int().positive().optional(),
  isActive: z.coerce.boolean().optional(),
});

/**
 * Inferred type from schema
 */
export type ListContractsInput = z.infer<typeof ListContractsQuerySchema>;

/**
 * GET /api/v1/automation/contracts - Response
 */
export type ListContractsResponse = ApiResponse<SerializedAutomationContract[]>;

// =============================================================================
// GET CONTRACT BY CHAIN
// =============================================================================

/**
 * GET /api/v1/automation/contracts/[chainId] - Path parameters
 */
export interface GetContractByChainParams {
  /**
   * Chain ID
   */
  chainId: number;
}

/**
 * GET /api/v1/automation/contracts/[chainId] - Query parameters
 */
export interface GetContractByChainRequest {
  /**
   * Contract type (required)
   */
  contractType: ContractType;
}

/**
 * Zod schema for get contract by chain query
 */
export const GetContractByChainQuerySchema = z.object({
  contractType: z.enum(CONTRACT_TYPES, {
    errorMap: () => ({ message: `Contract type must be one of: ${CONTRACT_TYPES.join(', ')}` }),
  }),
});

/**
 * Inferred type from schema
 */
export type GetContractByChainInput = z.infer<typeof GetContractByChainQuerySchema>;

/**
 * GET /api/v1/automation/contracts/[chainId] - Response
 */
export type GetContractByChainResponse = ApiResponse<SerializedAutomationContract>;

// =============================================================================
// GET CONTRACT STATUS (Polling)
// =============================================================================

/**
 * Contract deployment status for polling
 */
export interface ContractDeploymentStatus {
  id: string;
  contractType: ContractType;
  chainId: number;
  operationStatus: 'pending' | 'deploying' | 'completed' | 'failed';
  operationError?: string;
  contract?: SerializedAutomationContract;
}

/**
 * GET /api/v1/automation/contracts/status/[id] - Response
 */
export type GetContractStatusResponse = ApiResponse<ContractDeploymentStatus>;

// =============================================================================
// GET CONTRACT BYTECODE (for user-signed deployment)
// =============================================================================

/**
 * GET /api/v1/automation/contracts/bytecode - Query parameters
 *
 * Get contract bytecode for user to deploy via their wallet.
 */
export interface GetContractBytecodeRequest {
  /**
   * Chain ID to deploy on
   */
  chainId: number;

  /**
   * Contract type to deploy
   */
  contractType: ContractType;
}

/**
 * Zod schema for get contract bytecode query
 */
export const GetContractBytecodeQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  contractType: z.enum(CONTRACT_TYPES, {
    errorMap: () => ({ message: `Contract type must be one of: ${CONTRACT_TYPES.join(', ')}` }),
  }),
});

/**
 * Inferred type from schema
 */
export type GetContractBytecodeInput = z.infer<typeof GetContractBytecodeQuerySchema>;

/**
 * Contract bytecode response data
 */
export interface GetContractBytecodeResponseData {
  /**
   * Contract creation bytecode (hex string with 0x prefix)
   */
  bytecode: string;

  /**
   * ABI-encoded constructor arguments (hex string with 0x prefix)
   * Already encoded, append to bytecode for deployment
   */
  constructorArgs: string;

  /**
   * Contract type being deployed
   */
  contractType: ContractType;

  /**
   * Chain ID for deployment
   */
  chainId: number;

  /**
   * NFPM address used in constructor (for reference)
   */
  nfpmAddress: string;

  /**
   * Operator address used in constructor (autowallet address)
   */
  operatorAddress: string;
}

/**
 * GET /api/v1/automation/contracts/bytecode - Response
 */
export type GetContractBytecodeResponse = ApiResponse<GetContractBytecodeResponseData>;

// =============================================================================
// NOTIFY CONTRACT DEPLOYED (user signed on-chain)
// =============================================================================

/**
 * POST /api/v1/automation/contracts/notify - Request body
 *
 * Notify API after user deploys contract on-chain via their wallet.
 */
export interface NotifyContractDeployedRequest {
  /**
   * Chain ID where contract was deployed
   */
  chainId: number;

  /**
   * Contract type that was deployed
   */
  contractType: ContractType;

  /**
   * Deployed contract address (from transaction receipt)
   */
  contractAddress: string;

  /**
   * Deployment transaction hash
   */
  txHash: string;
}

/**
 * Zod schema for notify contract deployed request
 */
export const NotifyContractDeployedRequestSchema = z.object({
  chainId: z.number().int().positive(),
  contractType: z.enum(CONTRACT_TYPES, {
    errorMap: () => ({ message: `Contract type must be one of: ${CONTRACT_TYPES.join(', ')}` }),
  }),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
});

/**
 * Inferred type from schema
 */
export type NotifyContractDeployedInput = z.infer<typeof NotifyContractDeployedRequestSchema>;

/**
 * POST /api/v1/automation/contracts/notify - Response
 */
export type NotifyContractDeployedResponse = ApiResponse<SerializedAutomationContract>;
