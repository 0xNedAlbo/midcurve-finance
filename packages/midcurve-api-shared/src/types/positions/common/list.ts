/**
 * Position List Endpoint Types
 *
 * Types for listing user's positions across all protocols with pagination,
 * filtering, and sorting.
 *
 * The list endpoint returns protocol-agnostic common fields for sorting/filtering.
 * Protocol-specific display data is fetched by individual cards via detail endpoints.
 */

import type { PaginatedResponse } from '../../common/index.js';
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
  | 'totalApr';

/**
 * Sort direction options
 */
export type SortDirection = 'asc' | 'desc';

// =============================================================================
// List Item Type
// =============================================================================

/**
 * Common position fields returned by the list endpoint.
 *
 * These fields are protocol-agnostic and used for:
 * - Sorting (by value, APR, age, etc.)
 * - Filtering (by status, chain via positionHash, etc.)
 * - Protocol dispatch (parse positionHash to determine card type)
 *
 * NOT for display purposes — each card fetches its own detail data.
 *
 * All bigint fields are serialized as strings for JSON compatibility.
 * All Date fields are serialized as ISO 8601 strings.
 */
export interface PositionListItem {
  // Identity
  /** Position hash: "{protocol}/{...protocol-specific-fields}" e.g. "uniswapv3/1/12345" */
  positionHash: string;
  /** Protocol identifier e.g. "uniswapv3" */
  protocol: string;
  /** Position type e.g. "CL_TICKS" */
  positionType: string;

  // Financial (bigint as string) — for sorting/filtering by value
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  realizedCashflow: string;
  unrealizedCashflow: string;
  collectedFees: string;
  unClaimedFees: string;
  lastFeesCollectedAt: string | null;
  totalApr: number | null;

  // Price range (bigint as string)
  priceRangeLower: string;
  priceRangeUpper: string;

  // Lifecycle — for sorting/filtering by age, status
  positionOpenedAt: string;
  positionClosedAt: string | null;
  isActive: boolean;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Request / Response Types
// =============================================================================

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
 * GET /api/v1/positions/list - Response
 */
export type ListPositionsResponse = PaginatedResponse<PositionListItem> & {
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
  'totalApr',
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
        val as 'createdAt' | 'positionOpenedAt' | 'currentValue' | 'totalApr'
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

// =============================================================================
// Deprecated Types (to be removed after UI migration to protocol-specific cards)
// =============================================================================

import type { UniswapV3PositionResponse } from '../uniswapv3/typed-response.js';
import type { AprPeriodData } from './apr.js';
import type { PnLCurveResponseData } from './pnl-curve.js';

/**
 * @deprecated Use `PositionListItem` for list data and `UniswapV3PositionResponse`
 * for card display data. This type will be removed once all UI components
 * migrate to protocol-specific detail endpoints.
 */
export type ListPositionData = UniswapV3PositionResponse & {
  aprPeriods?: AprPeriodData[];
  pnlCurve?: PnLCurveResponseData;
};
