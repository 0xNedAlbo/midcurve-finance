/**
 * List Strategies Endpoint Types
 *
 * Types for listing user's strategies with pagination, filtering, and sorting.
 */

import type { PaginatedResponse } from '../common/index.js';
import type {
  SerializedStrategy,
  StrategyState,
  StrategySortBy,
  StrategySortDirection,
} from './common.js';
import {
  StrategyStateSchema,
  StrategySortBySchema,
  StrategySortDirectionSchema,
} from './common.js';
import { z } from 'zod';
import { PaginationParamsSchema } from '../common/pagination.js';

// =============================================================================
// QUERY PARAMETERS
// =============================================================================

/**
 * GET /api/v1/strategies - Query parameters
 */
export interface ListStrategiesParams {
  /**
   * Filter by state(s)
   * - Single state: 'active'
   * - Multiple states: 'active,paused'
   * - 'all': No filter (default)
   */
  state?: StrategyState | 'all';

  /**
   * Filter by strategy type
   * @example "delta-neutral"
   */
  strategyType?: string;

  /**
   * Sort field
   * @default 'createdAt'
   */
  sortBy?: StrategySortBy;

  /**
   * Sort direction
   * @default 'desc'
   */
  sortDirection?: StrategySortDirection;

  /**
   * Number of results per page
   * @minimum 1
   * @maximum 100
   * @default 20
   */
  limit?: number;

  /**
   * Pagination offset
   * @minimum 0
   * @default 0
   */
  offset?: number;

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
 * Zod schema for list strategies query parameters
 */
export const ListStrategiesQuerySchema = PaginationParamsSchema.extend({
  state: z
    .string()
    .optional()
    .default('all')
    .transform((val) => val as StrategyState | 'all')
    .pipe(z.union([StrategyStateSchema, z.literal('all')])),

  strategyType: z.string().optional(),

  sortBy: z
    .string()
    .optional()
    .default('createdAt')
    .transform((val) => val as StrategySortBy)
    .pipe(StrategySortBySchema),

  sortDirection: z
    .string()
    .optional()
    .default('desc')
    .transform((val) => val as StrategySortDirection)
    .pipe(StrategySortDirectionSchema),

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
export type ListStrategiesQuery = z.infer<typeof ListStrategiesQuerySchema>;

// =============================================================================
// RESPONSE
// =============================================================================

/**
 * GET /api/v1/strategies - Response
 */
export type ListStrategiesResponse = PaginatedResponse<SerializedStrategy> & {
  meta: {
    timestamp: string;
    filters: {
      state: StrategyState | 'all';
      strategyType?: string;
      sortBy: StrategySortBy;
      sortDirection: StrategySortDirection;
    };
  };
};
