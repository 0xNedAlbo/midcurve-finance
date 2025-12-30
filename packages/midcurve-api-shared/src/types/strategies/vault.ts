/**
 * Vault Deployment Endpoint Types
 *
 * Types for vault preparation, deployment, and registration.
 */

import type { ApiResponse } from '../common/index.js';
import { z } from 'zod';

// =============================================================================
// PREPARE VAULT DEPLOYMENT
// =============================================================================

/**
 * Vault token information
 */
export interface VaultTokenInfo {
  /** EIP-55 checksummed token address */
  address: string;
  /** Token symbol (e.g., "USDC") */
  symbol: string;
  /** Token decimals (e.g., 6 for USDC) */
  decimals: number;
}

/**
 * Constructor parameters for SimpleTokenVault deployment
 */
export interface VaultConstructorParams {
  /** Owner address (user's wallet) - can deposit/withdraw */
  owner: string;
  /** Operator address (automation wallet) - can use/return funds */
  operator: string;
  /** Funding token address (ERC-20) */
  token: string;
}

/**
 * GET /api/v1/strategies/:id/vault/prepare - Response data
 *
 * Returns all parameters needed to deploy a vault contract from the user's wallet.
 */
export interface PrepareVaultDeploymentData {
  /** Strategy ID this vault is for */
  strategyId: string;
  /** Chain ID where vault should be deployed (from manifest.fundingToken.chainId) */
  vaultChainId: number;
  /** Information about the vault's ERC-20 token */
  vaultToken: VaultTokenInfo;
  /** Constructor parameters for vault deployment */
  constructorParams: VaultConstructorParams;
  /** Compiled bytecode for SimpleTokenVault contract (0x prefixed hex) */
  bytecode: string;
}

/**
 * GET /api/v1/strategies/:id/vault/prepare - Response
 */
export type PrepareVaultDeploymentResponse = ApiResponse<PrepareVaultDeploymentData>;

// =============================================================================
// REGISTER VAULT
// =============================================================================

/**
 * POST /api/strategy/:addr/vault - Request body
 *
 * Registers a user-deployed vault with a strategy.
 */
export interface RegisterVaultRequest {
  /** Deployed vault contract address (EIP-55 checksummed) */
  vaultAddress: string;
  /** Chain ID where vault was deployed */
  chainId: number;
  /** Transaction hash of vault deployment (for audit trail) */
  deployTxHash?: string;
}

/**
 * Zod schema for register vault request
 */
export const RegisterVaultRequestSchema = z.object({
  vaultAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid vault address format'),
  chainId: z
    .number()
    .int()
    .positive('Chain ID must be a positive integer'),
  deployTxHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format')
    .optional(),
});

/**
 * Inferred type from schema
 */
export type RegisterVaultInput = z.infer<typeof RegisterVaultRequestSchema>;

/**
 * POST /api/strategy/:addr/vault - Response data
 */
export interface RegisterVaultData {
  /** Strategy ID the vault was registered to */
  strategyId: string;
  /** Deployed vault address */
  vaultAddress: string;
  /** Chain ID where vault is deployed */
  chainId: number;
  /** Vault token information */
  vaultToken: VaultTokenInfo;
  /** Operator (automation wallet) address */
  operatorAddress: string;
  /** Timestamp when vault was registered */
  registeredAt: string;
}

/**
 * POST /api/strategy/:addr/vault - Response
 */
export type RegisterVaultResponse = ApiResponse<RegisterVaultData>;
