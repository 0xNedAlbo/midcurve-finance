/**
 * Create Strategy Endpoint Types
 *
 * Types for creating a new strategy.
 */

import type { ApiResponse } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import { z } from 'zod';
import { StrategyConfigSchema } from './common.js';

// =============================================================================
// REQUEST
// =============================================================================

/**
 * POST /api/v1/strategies - Request body
 */
export interface CreateStrategyRequest {
  /**
   * User-friendly name for the strategy
   * @example "ETH-USDC Delta Neutral"
   */
  name: string;

  /**
   * Strategy type/category identifier
   * @example "delta-neutral", "yield-optimizer"
   */
  strategyType: string;

  /**
   * Strategy-specific configuration
   * Free-form JSON object
   */
  config: Record<string, unknown>;
}

/**
 * Zod schema for create strategy request
 */
export const CreateStrategyRequestSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less')
    .trim(),

  strategyType: z
    .string()
    .min(1, 'Strategy type is required')
    .max(50, 'Strategy type must be 50 characters or less')
    .trim(),

  config: StrategyConfigSchema.default({}),
});

/**
 * Inferred type from schema
 */
export type CreateStrategyInput = z.infer<typeof CreateStrategyRequestSchema>;

// =============================================================================
// RESPONSE
// =============================================================================

/**
 * POST /api/v1/strategies - Response
 */
export type CreateStrategyResponse = ApiResponse<SerializedStrategy>;
