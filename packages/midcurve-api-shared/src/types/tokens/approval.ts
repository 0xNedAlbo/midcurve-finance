/**
 * Token Approval Endpoint Types and Schemas
 *
 * Types and Zod schemas for ERC-20 and ERC-721 approval state endpoints.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// ============================================================================
// ERC-20 Approval
// ============================================================================

/**
 * GET /api/v1/tokens/erc20/approval - Query params
 */
export interface Erc20ApprovalQuery {
  /** ERC-20 token contract address */
  tokenAddress: string;
  /** Address that owns the tokens */
  ownerAddress: string;
  /** Address that is approved to spend tokens */
  spenderAddress: string;
  /** EVM chain ID */
  chainId: number;
}

/**
 * GET /api/v1/tokens/erc20/approval - Query validation schema
 */
export const Erc20ApprovalQuerySchema = z.object({
  tokenAddress: z
    .string()
    .min(1, 'Token address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address format'),
  ownerAddress: z
    .string()
    .min(1, 'Owner address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid owner address format'),
  spenderAddress: z
    .string()
    .min(1, 'Spender address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid spender address format'),
  chainId: z
    .string()
    .min(1, 'Chain ID is required')
    .transform((val) => parseInt(val, 10))
    .refine((val) => Number.isInteger(val) && val > 0, {
      message: 'Chain ID must be a positive integer',
    }),
});

/**
 * ERC-20 approval state data
 */
export interface Erc20ApprovalData {
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Chain ID */
  chainId: number;
  /** Approved allowance amount (as string for BigInt JSON serialization) */
  allowance: string;
  /** Whether unlimited approval is set (allowance >= MAX_UINT256) */
  isUnlimited: boolean;
  /** Whether any approval exists (allowance > 0) */
  hasApproval: boolean;
  /** ISO 8601 timestamp when data was fetched */
  timestamp: string;
}

/**
 * GET /api/v1/tokens/erc20/approval - Response
 */
export type Erc20ApprovalResponse = ApiResponse<Erc20ApprovalData>;

// ============================================================================
// ERC-721 Approval
// ============================================================================

/**
 * GET /api/v1/tokens/erc721/approval - Query params
 *
 * Either tokenId or operatorAddress must be provided:
 * - tokenId: Check if a specific address is approved for this token
 * - operatorAddress: Check if operator is approved for all tokens
 */
export interface Erc721ApprovalQuery {
  /** ERC-721 contract address */
  tokenAddress: string;
  /** Address that owns the NFT(s) */
  ownerAddress: string;
  /** Specific token ID to check approval for (optional) */
  tokenId?: string;
  /** Operator address to check approval for (optional) */
  operatorAddress?: string;
  /** EVM chain ID */
  chainId: number;
}

/**
 * GET /api/v1/tokens/erc721/approval - Query validation schema
 */
export const Erc721ApprovalQuerySchema = z
  .object({
    tokenAddress: z
      .string()
      .min(1, 'Token address is required')
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address format'),
    ownerAddress: z
      .string()
      .min(1, 'Owner address is required')
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid owner address format'),
    operatorAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid operator address format')
      .optional(),
    tokenId: z
      .string()
      .regex(/^\d+$/, 'Token ID must be a numeric string')
      .optional(),
    chainId: z
      .string()
      .min(1, 'Chain ID is required')
      .transform((val) => parseInt(val, 10))
      .refine((val) => Number.isInteger(val) && val > 0, {
        message: 'Chain ID must be a positive integer',
      }),
  })
  .refine((data) => data.operatorAddress || data.tokenId, {
    message: 'Either operatorAddress or tokenId must be provided',
  });

/**
 * ERC-721 approval state data
 */
export interface Erc721ApprovalData {
  /** NFT contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Chain ID */
  chainId: number;
  /** Token ID if querying specific token approval */
  tokenId?: string;
  /** Operator address if querying isApprovedForAll */
  operatorAddress?: string;
  /** For specific token: the approved address (or null if none) */
  approvedAddress?: string | null;
  /** For operator approval: whether the operator is approved for all tokens */
  isApprovedForAll?: boolean;
  /** Whether any approval exists for this query */
  hasApproval: boolean;
  /** ISO 8601 timestamp when data was fetched */
  timestamp: string;
}

/**
 * GET /api/v1/tokens/erc721/approval - Response
 */
export type Erc721ApprovalResponse = ApiResponse<Erc721ApprovalData>;
