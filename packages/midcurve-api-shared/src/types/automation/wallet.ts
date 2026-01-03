/**
 * Automation Wallet Endpoint Types
 *
 * Types for managing the user's automation wallet (operator address)
 * which executes close orders when price triggers are met.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Balance for a single chain
 */
export interface AutowalletChainBalance {
  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Balance in wei (as string for bigint serialization)
   */
  balance: string;

  /**
   * Native token symbol (ETH, MATIC, BNB, etc.)
   */
  symbol: string;

  /**
   * Native token decimals (usually 18)
   */
  decimals: number;
}

/**
 * Autowallet activity entry
 */
export interface AutowalletActivity {
  /**
   * Activity type
   */
  type: 'execution' | 'fund' | 'refund';

  /**
   * Chain ID where activity occurred
   */
  chainId: number;

  /**
   * Amount in wei (negative for outgoing, positive for incoming)
   */
  amount: string;

  /**
   * Transaction hash
   */
  txHash: string;

  /**
   * Related close order ID (for execution type)
   */
  closeOrderId?: string;

  /**
   * Timestamp
   */
  timestamp: string;
}

// =============================================================================
// GET AUTOWALLET
// =============================================================================

/**
 * GET /api/v1/automation/wallet - Response
 *
 * Get user's automation wallet info including address and balances.
 */
export interface GetAutowalletResponseData {
  /**
   * Automation wallet address (operator)
   */
  address: string;

  /**
   * Balances per chain
   */
  balances: AutowalletChainBalance[];

  /**
   * Recent activity
   */
  recentActivity: AutowalletActivity[];
}

export type GetAutowalletResponse = ApiResponse<GetAutowalletResponseData>;

// =============================================================================
// CREATE AUTOWALLET
// =============================================================================

/**
 * POST /api/v1/automation/wallet - Response
 *
 * Create user's automation wallet.
 */
export interface CreateAutowalletResponseData {
  /**
   * Automation wallet address
   */
  address: string;

  /**
   * Wallet label
   */
  label: string;

  /**
   * Creation timestamp
   */
  createdAt: string;
}

export type CreateAutowalletResponse = ApiResponse<CreateAutowalletResponseData>;

// =============================================================================
// REQUEST REFUND
// =============================================================================

/**
 * POST /api/v1/automation/wallet/refund - Request body
 *
 * Request refund of gas from autowallet back to user's wallet.
 * The destination address is determined by the signer from the database
 * (user's primary wallet), not passed in the request.
 */
export interface RefundAutowalletRequest {
  /**
   * Chain ID to refund from
   */
  chainId: number;

  /**
   * Amount to refund in wei (as string for bigint)
   */
  amount: string;
}

/**
 * Zod schema for refund request
 */
export const RefundAutowalletRequestSchema = z.object({
  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),

  amount: z
    .string()
    .regex(/^\d+$/, 'Amount must be a numeric string (wei)'),
});

/**
 * Inferred type from schema
 */
export type RefundAutowalletInput = z.infer<typeof RefundAutowalletRequestSchema>;

/**
 * Refund response data (async operation - returns 202)
 */
export interface RefundAutowalletResponseData {
  /**
   * Refund request ID
   */
  requestId: string;

  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Amount being refunded in wei
   */
  amount: string;

  /**
   * Destination address
   */
  toAddress: string;

  /**
   * Operation status
   */
  operationStatus: 'pending' | 'signing' | 'broadcasting' | 'completed' | 'failed';

  /**
   * Transaction hash (available after broadcasting)
   */
  txHash?: string;

  /**
   * URL to poll for status
   */
  pollUrl: string;
}

export type RefundAutowalletResponse = ApiResponse<RefundAutowalletResponseData>;

// =============================================================================
// GET REFUND STATUS (Polling)
// =============================================================================

/**
 * Refund operation status for polling
 */
export interface RefundOperationStatus {
  requestId: string;
  chainId: number;
  amount: string;
  toAddress: string;
  operationStatus: 'pending' | 'signing' | 'broadcasting' | 'completed' | 'failed';
  operationError?: string;
  txHash?: string;
}

/**
 * GET /api/v1/automation/wallet/refund/[requestId] - Response
 */
export type GetRefundStatusResponse = ApiResponse<RefundOperationStatus>;
