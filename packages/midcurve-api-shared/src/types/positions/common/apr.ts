/**
 * Position APR Period Types
 *
 * Types for the GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr endpoint
 *
 * Returns ordered list of APR periods for a position (descending by startTimestamp)
 * plus a summary of total APR metrics
 */

import type { ApiResponse } from '../../common/api-response.js';
import type { BigIntToString } from '../../common/serialization.js';
import type { AprSummary } from '@midcurve/shared';
import { z } from 'zod';

/**
 * Serialized APR period data for API response
 *
 * This is the JSON-serializable version of PositionAprPeriod from @midcurve/shared
 * All bigint fields are converted to strings for JSON compatibility
 */
export interface AprPeriodData {
  // Database fields
  id: string;
  createdAt: string;
  updatedAt: string;

  // Position reference
  positionId: string;

  // Period boundaries (linked to ledger events)
  startEventId: string;
  endEventId: string;

  // Time range
  startTimestamp: string;
  endTimestamp: string;
  durationSeconds: number;

  // Financial metrics (bigint → string)
  costBasis: string;
  collectedFeeValue: string;

  // APR metric
  aprBps: number;

  // Debugging/auditing
  eventCount: number;
}

/**
 * Serialized APR summary data for API response
 *
 * This is the JSON-serializable version of AprSummary from @midcurve/shared
 * All bigint fields are converted to strings for JSON compatibility
 *
 * Contains comprehensive APR metrics:
 * - Realized APR (from completed fee collection periods)
 * - Unrealized APR (from current unclaimed fees)
 * - Total APR (time-weighted combination)
 */
export type AprSummaryData = BigIntToString<AprSummary>;

/**
 * Path parameters for APR endpoint
 */
export interface AprPathParams {
  chainId: string;
  nftId: string;
}

/**
 * Response type for APR endpoint
 *
 * Returns both the detailed period-by-period breakdown AND a pre-calculated summary
 */
export interface AprPeriodsResponse extends ApiResponse<AprPeriodData[]> {
  /**
   * Pre-calculated APR summary combining all periods
   *
   * This eliminates the need for frontend calculation and ensures
   * consistency with the backend logic
   */
  summary: AprSummaryData;

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
 * Same validation as ledger endpoint
 */
export const AprPathParamsSchema = z.object({
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
