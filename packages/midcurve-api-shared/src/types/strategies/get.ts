/**
 * Get Strategy Endpoint Types
 *
 * Types for retrieving a single strategy by ID or contract address.
 */

import type { ApiResponse } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import { z } from 'zod';

// =============================================================================
// QUERY PARAMETERS
// =============================================================================

/**
 * GET /api/v1/strategies/:id - Query parameters
 */
export interface GetStrategyParams {
  /**
   * Include linked positions in response
   * @default false
   */
  includePositions?: boolean;

  /**
   * Include linked automation wallets in response
   * @default false
   */
  includeWallets?: boolean;
}

/**
 * Zod schema for get strategy query parameters
 */
export const GetStrategyQuerySchema = z.object({
  includePositions: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .pipe(z.boolean().default(false)),

  includeWallets: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .pipe(z.boolean().default(false)),
});

/**
 * Inferred type from schema
 */
export type GetStrategyQuery = z.infer<typeof GetStrategyQuerySchema>;

// =============================================================================
// RESPONSE
// =============================================================================

/**
 * GET /api/v1/strategies/:id - Response
 *
 * Returns the strategy with optional positions and wallets.
 */
export type GetStrategyResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// BY CONTRACT ADDRESS
// =============================================================================

/**
 * GET /api/v1/strategies/by-address/:contractAddress - Response
 *
 * Returns strategy by contract address (unique identifier).
 */
export type GetStrategyByAddressResponse = ApiResponse<SerializedStrategy>;
