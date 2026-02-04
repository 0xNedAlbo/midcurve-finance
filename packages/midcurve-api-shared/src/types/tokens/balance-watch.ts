/**
 * ERC-20 Token Balance Watch Endpoint Types and Schemas
 *
 * Types and Zod schemas for the database-backed balance subscription system.
 * Follows the same pattern as approval watch endpoints.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// ============================================================================
// Subscription Status
// ============================================================================

export type Erc20BalanceSubscriptionStatus = 'active' | 'paused' | 'deleted';

// ============================================================================
// POST /api/v1/tokens/erc20/balance/watch - Batch Request
// ============================================================================

/**
 * Token in batch request.
 */
export interface Erc20BalanceWatchTokenInput {
  /** ERC-20 token contract address */
  tokenAddress: string;
  /** EVM chain ID */
  chainId: number;
}

/**
 * POST request body for creating balance subscriptions.
 * Supports multiple tokens with a single wallet address (batch pattern).
 */
export interface Erc20BalanceWatchBatchRequest {
  /** Array of tokens to watch (max 50) */
  tokens: Erc20BalanceWatchTokenInput[];
  /** Wallet address to watch balance for (same for all tokens) */
  walletAddress: string;
}

/**
 * Zod schema for batch request validation.
 */
export const Erc20BalanceWatchBatchRequestSchema = z.object({
  tokens: z
    .array(
      z.object({
        tokenAddress: z
          .string()
          .min(1, 'Token address is required')
          .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address format'),
        chainId: z
          .number()
          .int('Chain ID must be an integer')
          .positive('Chain ID must be positive'),
      })
    )
    .min(1, 'At least one token is required')
    .max(50, 'Maximum 50 tokens per request'),
  walletAddress: z
    .string()
    .min(1, 'Wallet address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
});

export type Erc20BalanceWatchBatchInput = z.infer<typeof Erc20BalanceWatchBatchRequestSchema>;

// ============================================================================
// POST Response - Batch Subscription Info
// ============================================================================

/**
 * Single subscription info in batch response.
 */
export interface Erc20BalanceSubscriptionInfo {
  /** Unique subscription ID for polling */
  subscriptionId: string;
  /** URL for polling this subscription */
  pollUrl: string;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Chain ID */
  chainId: number;
  /** Wallet address being watched */
  walletAddress: string;
  /** Current balance (bigint as string) */
  currentBalance: string;
  /** Subscription status */
  status: Erc20BalanceSubscriptionStatus;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
}

/**
 * POST response data containing array of created subscriptions.
 */
export interface Erc20BalanceWatchBatchResponseData {
  subscriptions: Erc20BalanceSubscriptionInfo[];
}

export type Erc20BalanceWatchBatchResponse = ApiResponse<Erc20BalanceWatchBatchResponseData>;

// ============================================================================
// GET /api/v1/tokens/erc20/balance/watch/[subscriptionId] - Poll Response
// ============================================================================

/**
 * GET response data for polling a subscription.
 */
export interface Erc20BalanceSubscriptionPollResponseData {
  /** Unique subscription ID */
  subscriptionId: string;
  /** Subscription status */
  status: Erc20BalanceSubscriptionStatus;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Wallet address being watched */
  walletAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current balance (bigint as string) */
  currentBalance: string;
  /** URL for polling this subscription */
  pollUrl: string;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
  /** ISO 8601 timestamp of last poll */
  lastPolledAt: string;
  /** ISO 8601 timestamp when balance last changed */
  lastUpdatedAt: string;
}

export type Erc20BalanceSubscriptionPollResponse = ApiResponse<Erc20BalanceSubscriptionPollResponseData>;

// ============================================================================
// DELETE /api/v1/tokens/erc20/balance/watch/[subscriptionId] - Cancel Response
// ============================================================================

/**
 * DELETE response data for canceling a subscription.
 */
export interface Erc20BalanceSubscriptionCancelResponseData {
  /** Subscription ID that was canceled */
  subscriptionId: string;
  /** Final status (always 'deleted') */
  status: 'deleted';
  /** Human-readable message */
  message: string;
}

export type Erc20BalanceSubscriptionCancelResponse = ApiResponse<Erc20BalanceSubscriptionCancelResponseData>;
