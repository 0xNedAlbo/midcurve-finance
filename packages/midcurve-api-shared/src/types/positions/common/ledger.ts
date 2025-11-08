/**
 * Position Ledger Types
 *
 * Types for the GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger endpoint
 *
 * Returns ordered list of position ledger events (descending by blockNumber->txIndex->logIndex)
 */

import type { ApiResponse } from '../../common/api-response.js';
import type { SerializedValue } from '../../common/serialization.js';
import { z } from 'zod';

/**
 * Serialized ledger event data for API response
 *
 * This is the JSON-serializable version of UniswapV3LedgerEvent from @midcurve/shared
 * All bigint fields are converted to strings for JSON compatibility
 */
export interface LedgerEventData {
  id: string;
  createdAt: string;
  updatedAt: string;
  positionId: string;
  protocol: 'uniswapv3';
  previousId: string | null;
  timestamp: string;
  eventType: 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT';
  inputHash: string;

  // Financial data (bigint → string)
  poolPrice: string;
  token0Amount: string;
  token1Amount: string;
  tokenValue: string;
  rewards: Array<{
    tokenId: string;
    tokenAmount: string;
    tokenValue: string;
  }>;

  // PnL tracking (bigint → string)
  deltaCostBasis: string;
  costBasisAfter: string;
  deltaPnl: string;
  pnlAfter: string;

  // Protocol-specific (JSON fields with bigints serialized)
  config: SerializedValue;
  state: SerializedValue;
}

/**
 * Path parameters for ledger endpoint
 */
export interface LedgerPathParams {
  chainId: string;
  nftId: string;
}

/**
 * Response type for ledger endpoint
 */
export interface LedgerEventsResponse extends ApiResponse<LedgerEventData[]> {
  meta?: {
    timestamp: string;
    count: number;
    requestId?: string;
  };
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Path parameter validation schema
 *
 * Validates chainId and nftId from URL path
 */
export const LedgerPathParamsSchema = z.object({
  /**
   * Chain ID (e.g., 1 for Ethereum, 42161 for Arbitrum)
   * Must be a valid positive integer
   */
  chainId: z
    .string()
    .regex(/^\d+$/, 'Chain ID must be a valid number')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),

  /**
   * NFT Position Manager token ID
   * Can be very large, so we keep as string for validation
   * Service layer will convert to bigint
   */
  nftId: z
    .string()
    .regex(/^\d+$/, 'NFT ID must be a valid number')
    .min(1, 'NFT ID is required'),
});
