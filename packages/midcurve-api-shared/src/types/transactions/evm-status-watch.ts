/**
 * EVM Transaction Status Watch Endpoint Types and Schemas
 *
 * Types and Zod schemas for the database-backed transaction status subscription system.
 * Single transaction per request (not batch) since each tx is independent.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';
import type { TxStatusValue, SerializedTransactionLog } from '@midcurve/shared';

// ============================================================================
// Subscription Status
// ============================================================================

export type EvmTxStatusSubscriptionStatus = 'active' | 'paused' | 'deleted';

// ============================================================================
// POST /api/v1/transactions/evm/status/watch - Single Request
// ============================================================================

/**
 * POST request body for creating a transaction status subscription.
 * Single transaction per request (each tx is independent).
 */
export interface EvmTxStatusWatchRequest {
  /** Transaction hash (0x-prefixed, 64 hex characters) */
  txHash: string;
  /** EVM chain ID */
  chainId: number;
  /** Target number of confirmations before marking complete (default: 12) */
  targetConfirmations?: number;
}

/**
 * Zod schema for request validation.
 */
export const EvmTxStatusWatchRequestSchema = z.object({
  txHash: z
    .string()
    .min(1, 'Transaction hash is required')
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format'),
  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
  targetConfirmations: z
    .number()
    .int('Target confirmations must be an integer')
    .positive('Target confirmations must be positive')
    .max(100, 'Target confirmations cannot exceed 100')
    .optional()
    .default(12),
});

export type EvmTxStatusWatchInput = z.infer<typeof EvmTxStatusWatchRequestSchema>;

// ============================================================================
// POST Response - Subscription Info
// ============================================================================

/**
 * POST response data for created subscription.
 */
export interface EvmTxStatusSubscriptionInfo {
  /** Unique subscription ID for polling */
  subscriptionId: string;
  /** URL for polling this subscription */
  pollUrl: string;
  /** Transaction hash */
  txHash: string;
  /** Chain ID */
  chainId: number;
  /** Target confirmations for completion */
  targetConfirmations: number;
  /** Current transaction status */
  status: TxStatusValue;
  /** Current number of confirmations */
  confirmations: number;
  /** Whether tracking is complete (confirmations >= target) */
  isComplete: boolean;
  /** Subscription status */
  subscriptionStatus: EvmTxStatusSubscriptionStatus;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
}

/**
 * POST response data containing created subscription.
 */
export interface EvmTxStatusWatchResponseData {
  subscription: EvmTxStatusSubscriptionInfo;
}

export type EvmTxStatusWatchResponse = ApiResponse<EvmTxStatusWatchResponseData>;

// ============================================================================
// GET /api/v1/transactions/evm/status/watch/[subscriptionId] - Poll Response
// ============================================================================

/**
 * GET response data for polling a subscription.
 */
export interface EvmTxStatusSubscriptionPollResponseData {
  /** Unique subscription ID */
  subscriptionId: string;
  /** Subscription status */
  subscriptionStatus: EvmTxStatusSubscriptionStatus;
  /** Transaction hash */
  txHash: string;
  /** Chain ID */
  chainId: number;
  /** Target confirmations for completion */
  targetConfirmations: number;
  /** Current transaction status */
  status: TxStatusValue;
  /** Block number where transaction was included (as string for BigInt) */
  blockNumber: string | null;
  /** Block hash where transaction was included */
  blockHash: string | null;
  /** Current number of confirmations */
  confirmations: number;
  /** Whether tracking is complete (confirmations >= target) */
  isComplete: boolean;
  /** Gas used by the transaction (as string for BigInt) */
  gasUsed: string | null;
  /** Effective gas price paid (as string for BigInt) */
  effectiveGasPrice: string | null;
  /** Number of logs emitted by the transaction */
  logsCount: number | null;
  /** Serialized transaction logs for frontend event parsing */
  logs?: SerializedTransactionLog[] | null;
  /** Contract address if this was a contract creation */
  contractAddress: string | null;
  /** URL for polling this subscription */
  pollUrl: string;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
  /** ISO 8601 timestamp of last poll */
  lastPolledAt: string;
  /** ISO 8601 timestamp when status was last checked by worker */
  lastCheckedAt: string;
  /** ISO 8601 timestamp when tracking completed (null if not complete) */
  completedAt: string | null;
}

export type EvmTxStatusSubscriptionPollResponse = ApiResponse<EvmTxStatusSubscriptionPollResponseData>;

// ============================================================================
// DELETE /api/v1/transactions/evm/status/watch/[subscriptionId] - Cancel Response
// ============================================================================

/**
 * DELETE response data for canceling a subscription.
 */
export interface EvmTxStatusSubscriptionCancelResponseData {
  /** Subscription ID that was canceled */
  subscriptionId: string;
  /** Final status (always 'deleted') */
  status: 'deleted';
  /** Human-readable message */
  message: string;
}

export type EvmTxStatusSubscriptionCancelResponse = ApiResponse<EvmTxStatusSubscriptionCancelResponseData>;
