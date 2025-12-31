/**
 * Strategy Position Management Endpoint Types
 *
 * Types for linking and unlinking positions to/from strategies.
 */

import type { ApiResponse } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import type { BigIntToString } from '../common/index.js';
import type { AnyPosition } from '@midcurve/shared';
import { z } from 'zod';

// =============================================================================
// LINK POSITION
// =============================================================================

/**
 * POST /api/v1/strategies/:id/positions - Request body
 *
 * Links a position to a strategy.
 */
export interface LinkPositionRequest {
  /**
   * Position ID to link
   */
  positionId: string;
}

/**
 * Zod schema for link position request
 */
export const LinkPositionRequestSchema = z.object({
  positionId: z
    .string()
    .min(1, 'Position ID is required'),
});

/**
 * Inferred type from schema
 */
export type LinkPositionInput = z.infer<typeof LinkPositionRequestSchema>;

/**
 * POST /api/v1/strategies/:id/positions - Response
 *
 * Returns the updated strategy with linked positions.
 */
export type LinkPositionResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// UNLINK POSITION
// =============================================================================

/**
 * DELETE /api/v1/strategies/:id/positions/:positionId - Response
 *
 * Unlinks a position from a strategy.
 * No request body required.
 */
export type UnlinkPositionResponse = ApiResponse<{ success: true }>;

// =============================================================================
// GET POSITIONS
// =============================================================================

/**
 * Serialized position for API response
 */
export type SerializedPosition = BigIntToString<AnyPosition>;

/**
 * GET /api/v1/strategies/:id/positions - Response
 *
 * Returns all positions linked to a strategy.
 */
export type GetStrategyPositionsResponse = ApiResponse<SerializedPosition[]>;
