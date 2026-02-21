/**
 * Position Discovery (Wallet Scan) Endpoint Types
 *
 * POST /api/v1/positions/discover
 */

import type { ApiResponse } from '../../common/index.js';
import { z } from 'zod';

/**
 * POST /api/v1/positions/discover - Request body
 */
export interface DiscoverPositionsRequest {
  /**
   * Optional list of EVM chain IDs to scan.
   * If omitted or empty, all supported chains are scanned.
   * @example [1, 42161, 8453]
   */
  chainIds?: number[];
}

/**
 * Discovery result stats returned by the endpoint
 */
export interface DiscoverPositionsData {
  /** Total active positions found across scanned chains */
  found: number;
  /** Positions newly imported into the database */
  imported: number;
  /** Positions already in DB (skipped) */
  skipped: number;
  /** Positions that failed to import */
  errors: number;
}

/**
 * POST /api/v1/positions/discover - Response
 */
export type DiscoverPositionsResponse = ApiResponse<DiscoverPositionsData>;

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * POST /api/v1/positions/discover - Request validation
 *
 * chainIds is optional. If provided, each must be a positive integer.
 */
export const DiscoverPositionsRequestSchema = z.object({
  chainIds: z
    .array(
      z
        .number()
        .int('Chain ID must be an integer')
        .positive('Chain ID must be positive'),
    )
    .optional(),
});
