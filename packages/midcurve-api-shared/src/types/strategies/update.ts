/**
 * Update Strategy Endpoint Types
 *
 * Types for updating strategy name, type, or configuration.
 */

import type { ApiResponse } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import { z } from 'zod';
import { StrategyConfigSchema } from './common.js';

// =============================================================================
// REQUEST
// =============================================================================

/**
 * PATCH /api/v1/strategies/:id - Request body
 *
 * All fields are optional. Only provided fields will be updated.
 */
export interface UpdateStrategyRequest {
  /**
   * New user-friendly name
   * @example "ETH-USDC Delta Neutral v2"
   */
  name?: string;

  /**
   * New strategy type/category identifier
   * @example "range-rebalancer"
   */
  strategyType?: string;

  /**
   * Updated configuration
   * Replaces the entire config object
   */
  config?: Record<string, unknown>;
}

/**
 * Zod schema for update strategy request
 */
export const UpdateStrategyRequestSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name cannot be empty')
      .max(100, 'Name must be 100 characters or less')
      .trim()
      .optional(),

    strategyType: z
      .string()
      .min(1, 'Strategy type cannot be empty')
      .max(50, 'Strategy type must be 50 characters or less')
      .trim()
      .optional(),

    config: StrategyConfigSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Inferred type from schema
 */
export type UpdateStrategyInput = z.infer<typeof UpdateStrategyRequestSchema>;

// =============================================================================
// RESPONSE
// =============================================================================

/**
 * PATCH /api/v1/strategies/:id - Response
 */
export type UpdateStrategyResponse = ApiResponse<SerializedStrategy>;
