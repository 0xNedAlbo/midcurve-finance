/**
 * Position List Endpoint Types
 *
 * Types for listing user's positions across all protocols with pagination,
 * filtering, and sorting.
 */

import type { BigIntToString, PaginatedResponse } from '../../common/index.js';
import type { AnyPosition } from '@midcurve/shared';
import { z } from 'zod';
import { PaginationParamsSchema } from '../../common/pagination.js';

/**
 * Position status filter options
 */
export type PositionStatus = 'active' | 'closed' | 'all';

/**
 * Sort field options
 */
export type PositionSortBy =
  | 'createdAt'
  | 'positionOpenedAt'
  | 'currentValue'
  | 'unrealizedPnl';

/**
 * Sort direction options
 */
export type SortDirection = 'asc' | 'desc';

/**
 * GET /api/v1/positions/list - Query parameters
 */
export interface ListPositionsParams {
  /**
   * Filter by protocol(s)
   * Can be a single protocol or multiple protocols
   * @example ['uniswapv3', 'orca']
   */
  protocols?: string[];

  /**
   * Filter by position status
   * - 'active': Only active positions (isActive = true)
   * - 'closed': Only closed positions (isActive = false)
   * - 'all': All positions (no filter)
   * @default 'all'
   */
  status?: PositionStatus;

  /**
   * Sort field
   * @default 'createdAt'
   */
  sortBy?: PositionSortBy;

  /**
   * Sort direction
   * @default 'desc'
   */
  sortDirection?: SortDirection;

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
}

/**
 * Position data for API response
 *
 * Based on AnyPosition from @midcurve/shared with:
 * - bigint fields converted to strings (for JSON serialization)
 * - Date fields converted to ISO 8601 strings
 * - Fully nested pool and token objects
 * - Config and state as unknown (not protocol-specific)
 */
export type ListPositionData = BigIntToString<AnyPosition>;

/**
 * GET /api/v1/positions/list - Response
 */
export type ListPositionsResponse = PaginatedResponse<ListPositionData> & {
  meta: {
    timestamp: string;
    filters: {
      protocols?: string[];
      status: PositionStatus;
      sortBy: PositionSortBy;
      sortDirection: SortDirection;
    };
  };
};

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Position status enum for validation
 */
export const PositionStatusSchema = z.enum(['active', 'closed', 'all']);

/**
 * Sort field enum for validation
 */
export const PositionSortBySchema = z.enum([
  'createdAt',
  'positionOpenedAt',
  'currentValue',
  'unrealizedPnl',
]);

/**
 * Sort direction enum for validation
 */
export const SortDirectionSchema = z.enum(['asc', 'desc']);

/**
 * Zod schema for query parameters
 *
 * Validates and transforms query string parameters to typed values.
 */
export const ListPositionsQuerySchema = PaginationParamsSchema.extend({
  protocols: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((p) => p.trim()) : undefined))
    .pipe(z.array(z.string()).optional()),

  status: z
    .string()
    .optional()
    .default('all')
    .transform((val) => val as 'active' | 'closed' | 'all')
    .pipe(PositionStatusSchema),

  sortBy: z
    .string()
    .optional()
    .default('createdAt')
    .transform(
      (val) =>
        val as 'createdAt' | 'positionOpenedAt' | 'currentValue' | 'unrealizedPnl'
    )
    .pipe(PositionSortBySchema),

  sortDirection: z
    .string()
    .optional()
    .default('desc')
    .transform((val) => val as 'asc' | 'desc')
    .pipe(SortDirectionSchema),
});

/**
 * Inferred type from schema
 */
export type ListPositionsQuery = z.infer<typeof ListPositionsQuerySchema>;
