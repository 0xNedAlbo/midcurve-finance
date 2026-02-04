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
// ERC-20 Approval Watch (REST Polling Pattern)
// ============================================================================

/**
 * Approval watch status
 */
export type Erc20ApprovalWatchStatus = 'pending' | 'ready' | 'expired';

/**
 * POST /api/v1/tokens/erc20/approval/watch - Request body
 *
 * Initiate a watch for token approval state changes.
 */
export interface Erc20ApprovalWatchRequest {
  /** ERC-20 token contract address */
  tokenAddress: string;
  /** Address that owns the tokens */
  ownerAddress: string;
  /** Address that is approved to spend tokens */
  spenderAddress: string;
  /** EVM chain ID */
  chainId: number;
  /** Required approval amount (as string for BigInt JSON serialization) */
  requiredApprovalAmount: string;
}

/**
 * POST /api/v1/tokens/erc20/approval/watch - Zod validation schema
 */
export const Erc20ApprovalWatchRequestSchema = z.object({
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
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
  requiredApprovalAmount: z
    .string()
    .regex(/^\d+$/, 'Required approval amount must be a numeric string'),
});

/**
 * Inferred type from schema
 */
export type Erc20ApprovalWatchInput = z.infer<typeof Erc20ApprovalWatchRequestSchema>;

/**
 * POST /api/v1/tokens/erc20/approval/watch - Response data (202 Accepted)
 *
 * Initial response when watch is created and approval is pending.
 */
export interface Erc20ApprovalWatchInitResponseData {
  /** Unique poll ID for this watch request */
  pollId: string;
  /** Current watch status */
  status: Erc20ApprovalWatchStatus;
  /** URL to poll for status updates */
  pollUrl: string;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Chain ID */
  chainId: number;
  /** Required approval amount (as string) */
  requiredApprovalAmount: string;
  /** Current allowance amount (as string) */
  currentAllowance: string;
  /** Whether unlimited approval is set */
  isUnlimited: boolean;
  /** ISO 8601 timestamp when watch was created */
  createdAt: string;
  /** ISO 8601 timestamp when watch expires */
  expiresAt: string;
}

/**
 * Response type for POST when approval is pending
 */
export type Erc20ApprovalWatchInitResponse = ApiResponse<Erc20ApprovalWatchInitResponseData>;

/**
 * POST /api/v1/tokens/erc20/approval/watch - Response data (200 OK)
 *
 * Response when approval is already sufficient (no polling needed).
 */
export interface Erc20ApprovalWatchReadyResponseData {
  /** Status is 'ready' - no polling needed */
  status: 'ready';
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Chain ID */
  chainId: number;
  /** Required approval amount (as string) */
  requiredApprovalAmount: string;
  /** Current allowance amount (as string) */
  currentAllowance: string;
  /** Whether unlimited approval is set */
  isUnlimited: boolean;
  /** Whether any approval exists (allowance > 0) */
  hasApproval: boolean;
  /** ISO 8601 timestamp when data was fetched */
  timestamp: string;
}

/**
 * Response type for POST when approval is already ready
 */
export type Erc20ApprovalWatchReadyResponse = ApiResponse<Erc20ApprovalWatchReadyResponseData>;

/**
 * GET /api/v1/tokens/erc20/approval/watch/[pollId] - Response data
 *
 * Response when polling for approval watch status.
 */
export interface Erc20ApprovalWatchPollResponseData {
  /** Unique poll ID */
  pollId: string;
  /** Current watch status */
  status: Erc20ApprovalWatchStatus;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Chain ID */
  chainId: number;
  /** Required approval amount (as string) */
  requiredApprovalAmount: string;
  /** Current allowance amount (as string) */
  currentAllowance: string;
  /** Whether unlimited approval is set */
  isUnlimited: boolean;
  /** Whether any approval exists (allowance > 0) */
  hasApproval: boolean;
  /** URL to poll for status updates (only if status is 'pending') */
  pollUrl?: string;
  /** ISO 8601 timestamp when watch was created */
  createdAt: string;
  /** ISO 8601 timestamp when watch expires (only if status is 'pending') */
  expiresAt?: string;
  /** ISO 8601 timestamp of last check */
  lastCheckedAt: string;
}

/**
 * Response type for GET poll endpoint
 */
export type Erc20ApprovalWatchPollResponse = ApiResponse<Erc20ApprovalWatchPollResponseData>;

/**
 * DELETE /api/v1/tokens/erc20/approval/watch/[pollId] - Response data
 *
 * Response when cancelling an approval watch subscription.
 */
export interface Erc20ApprovalWatchCancelResponseData {
  /** Poll ID that was cancelled */
  pollId: string;
  /** Status is 'cancelled' */
  status: 'cancelled';
  /** Confirmation message */
  message: string;
}

/**
 * Response type for DELETE cancel endpoint
 */
export type Erc20ApprovalWatchCancelResponse = ApiResponse<Erc20ApprovalWatchCancelResponseData>;

// ============================================================================
// ERC-20 Approval Watch Batch (Database-backed Subscription Pattern)
// ============================================================================

/**
 * Subscription status for database-backed approval watching.
 */
export type Erc20ApprovalSubscriptionStatus = 'active' | 'paused' | 'deleted';

/**
 * Token in batch request.
 */
export interface Erc20ApprovalWatchTokenInput {
  /** ERC-20 token contract address */
  tokenAddress: string;
  /** EVM chain ID */
  chainId: number;
}

/**
 * POST /api/v1/tokens/erc20/approval/watch - Batch request body
 *
 * Create subscriptions for multiple tokens with the same owner/spender.
 */
export interface Erc20ApprovalWatchBatchRequest {
  /** Array of tokens to watch */
  tokens: Erc20ApprovalWatchTokenInput[];
  /** Address that owns the tokens (same for all) */
  ownerAddress: string;
  /** Address approved to spend tokens (same for all) */
  spenderAddress: string;
}

/**
 * POST /api/v1/tokens/erc20/approval/watch - Batch Zod validation schema
 */
export const Erc20ApprovalWatchBatchRequestSchema = z.object({
  tokens: z
    .array(
      z.object({
        tokenAddress: z
          .string()
          .min(1, 'Token address is required')
          .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address format'),
        chainId: z.number().int('Chain ID must be an integer').positive('Chain ID must be positive'),
      })
    )
    .min(1, 'At least one token is required')
    .max(50, 'Maximum 50 tokens per request'),
  ownerAddress: z
    .string()
    .min(1, 'Owner address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid owner address format'),
  spenderAddress: z
    .string()
    .min(1, 'Spender address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid spender address format'),
});

/**
 * Inferred type from batch schema
 */
export type Erc20ApprovalWatchBatchInput = z.infer<typeof Erc20ApprovalWatchBatchRequestSchema>;

/**
 * Single subscription info in batch response.
 */
export interface Erc20ApprovalSubscriptionInfo {
  /** Unique subscription ID for polling */
  subscriptionId: string;
  /** URL to poll for status updates */
  pollUrl: string;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Chain ID */
  chainId: number;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Current allowance amount (as string) */
  currentAllowance: string;
  /** Whether unlimited approval is set */
  isUnlimited: boolean;
  /** Whether any approval exists (allowance > 0) */
  hasApproval: boolean;
  /** Subscription status */
  status: Erc20ApprovalSubscriptionStatus;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
}

/**
 * POST /api/v1/tokens/erc20/approval/watch - Batch response data (202 Accepted)
 */
export interface Erc20ApprovalWatchBatchResponseData {
  /** Array of created subscriptions */
  subscriptions: Erc20ApprovalSubscriptionInfo[];
}

/**
 * Response type for POST batch endpoint
 */
export type Erc20ApprovalWatchBatchResponse = ApiResponse<Erc20ApprovalWatchBatchResponseData>;

/**
 * GET /api/v1/tokens/erc20/approval/watch/[subscriptionId] - Subscription poll response data
 *
 * Response when polling for approval subscription status (database-backed).
 */
export interface Erc20ApprovalSubscriptionPollResponseData {
  /** Unique subscription ID */
  subscriptionId: string;
  /** Current subscription status */
  status: Erc20ApprovalSubscriptionStatus;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current allowance amount (as string) */
  currentAllowance: string;
  /** Whether unlimited approval is set */
  isUnlimited: boolean;
  /** Whether any approval exists (allowance > 0) */
  hasApproval: boolean;
  /** URL to poll for status updates */
  pollUrl: string;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
  /** ISO 8601 timestamp of last poll */
  lastPolledAt: string;
  /** ISO 8601 timestamp when approval state was last updated (from WebSocket) */
  lastUpdatedAt: string;
}

/**
 * Response type for GET subscription poll endpoint (database-backed)
 */
export type Erc20ApprovalSubscriptionPollResponse = ApiResponse<Erc20ApprovalSubscriptionPollResponseData>;

/**
 * DELETE /api/v1/tokens/erc20/approval/watch/[subscriptionId] - Subscription cancel response data
 */
export interface Erc20ApprovalSubscriptionCancelResponseData {
  /** Subscription ID that was cancelled */
  subscriptionId: string;
  /** Status is 'deleted' */
  status: 'deleted';
  /** Confirmation message */
  message: string;
}

/**
 * Response type for DELETE subscription cancel endpoint
 */
export type Erc20ApprovalSubscriptionCancelResponse = ApiResponse<Erc20ApprovalSubscriptionCancelResponseData>;

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
