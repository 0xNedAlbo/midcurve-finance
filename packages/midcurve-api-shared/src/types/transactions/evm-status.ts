/**
 * EVM Transaction Status Endpoint Types and Schemas
 *
 * Types and Zod schemas for EVM transaction status endpoint.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * Transaction status values
 */
export type TransactionStatusValue = 'success' | 'reverted' | 'pending' | 'not_found';

/**
 * GET /api/v1/transactions/evm/status - Query params
 */
export interface EvmTransactionStatusQuery {
  /** Transaction hash (0x-prefixed, 64 hex characters) */
  txHash: string;
  /** EVM chain ID */
  chainId: number;
}

/**
 * GET /api/v1/transactions/evm/status - Query validation schema
 */
export const EvmTransactionStatusQuerySchema = z.object({
  txHash: z
    .string()
    .min(1, 'Transaction hash is required')
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format'),
  chainId: z
    .string()
    .min(1, 'Chain ID is required')
    .transform((val) => parseInt(val, 10))
    .refine((val) => Number.isInteger(val) && val > 0, {
      message: 'Chain ID must be a positive integer',
    }),
});

/**
 * EVM transaction status data
 */
export interface EvmTransactionStatusData {
  /** Transaction hash */
  txHash: string;
  /** Chain ID */
  chainId: number;
  /** Transaction status */
  status: TransactionStatusValue;
  /** Block number where transaction was included (as string for BigInt) */
  blockNumber?: string;
  /** Block hash where transaction was included */
  blockHash?: string;
  /** Gas used by the transaction (as string for BigInt) */
  gasUsed?: string;
  /** Effective gas price paid (as string for BigInt) */
  effectiveGasPrice?: string;
  /** Number of block confirmations */
  confirmations?: number;
  /** Number of logs emitted by the transaction */
  logsCount?: number;
  /** Contract address if this was a contract creation */
  contractAddress?: string | null;
  /** ISO 8601 timestamp when data was fetched */
  timestamp: string;
}

/**
 * GET /api/v1/transactions/evm/status - Response
 */
export type EvmTransactionStatusResponse = ApiResponse<EvmTransactionStatusData>;
