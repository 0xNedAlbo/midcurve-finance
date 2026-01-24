/**
 * Position List Input Types
 *
 * Type definitions for filtering, sorting, and paginating position lists.
 * Used by PositionListService for cross-protocol position queries.
 */

import type { PositionInterface } from '@midcurve/shared';

/**
 * Filters for listing positions
 *
 * All filters are optional. Without filters, returns all positions for the user.
 */
export interface PositionListFilters {
  /**
   * Filter by position status
   *
   * - 'active': Only open positions (isActive = true)
   * - 'closed': Only closed positions (isActive = false)
   * - 'all': Both active and closed positions
   *
   * @default 'all'
   */
  status?: 'active' | 'closed' | 'all';

  /**
   * Filter by protocol(s)
   *
   * Array of protocol identifiers to include in results.
   * - Undefined: Include all protocols
   * - Empty array: Include all protocols
   * - Non-empty array: Only include specified protocols
   *
   * @example ['uniswapv3'] - Only Uniswap V3 positions
   * @example ['uniswapv3', 'orca'] - Uniswap V3 and Orca positions
   */
  protocols?: string[];

  /**
   * Pagination: Maximum number of results to return
   *
   * @default 20
   * @min 1
   * @max 100
   */
  limit?: number;

  /**
   * Pagination: Number of results to skip
   *
   * Use with limit for pagination:
   * - Page 1: offset = 0, limit = 20
   * - Page 2: offset = 20, limit = 20
   * - Page 3: offset = 40, limit = 20
   *
   * @default 0
   * @min 0
   */
  offset?: number;

  /**
   * Sort field
   *
   * Field to sort results by:
   * - 'createdAt': When position was added to database
   * - 'positionOpenedAt': When position was opened on-chain
   * - 'totalApr': Total APR (fees + rewards)
   *
   * @default 'createdAt'
   */
  sortBy?: 'createdAt' | 'positionOpenedAt' | 'totalApr';

  /**
   * Sort direction
   *
   * @default 'desc'
   */
  sortDirection?: 'asc' | 'desc';
}

/**
 * Result object for position list queries
 *
 * Contains positions array plus metadata for pagination.
 */
export interface PositionListResult {
  /**
   * Array of positions matching the filter criteria
   *
   * Positions are returned as PositionInterface.
   * For fully-typed positions with protocol-specific accessors, use protocol-specific services.
   */
  positions: PositionInterface[];

  /**
   * Total count of positions matching the filter (ignoring pagination)
   *
   * Use this to calculate total pages:
   * ```typescript
   * const totalPages = Math.ceil(total / limit);
   * ```
   */
  total: number;

  /**
   * Actual limit used (after validation)
   *
   * May differ from requested limit if validation clamped it to [1, 100].
   */
  limit: number;

  /**
   * Actual offset used (after validation)
   *
   * May differ from requested offset if validation clamped it to >= 0.
   */
  offset: number;
}
