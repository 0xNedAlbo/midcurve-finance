/**
 * Position List Input Types
 *
 * Type definitions for filtering, sorting, and paginating position lists.
 * Used by PositionListService for cross-protocol position queries.
 */

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
   * - 'currentValue': Current position value in quote token
   * - 'totalApr': Total APR (fees + rewards)
   *
   * @default 'createdAt'
   */
  sortBy?: 'createdAt' | 'positionOpenedAt' | 'currentValue' | 'totalApr';

  /**
   * Sort direction
   *
   * @default 'desc'
   */
  sortDirection?: 'asc' | 'desc';
}

/**
 * Raw position row returned from Prisma select (common fields only).
 *
 * No pool/token joins — just the position table columns needed for
 * sorting, filtering, and protocol dispatch.
 *
 * bigint fields are stored as strings in Prisma (Decimal columns).
 * Date fields are native Date objects.
 */
export interface PositionListRow {
  id: string;
  positionHash: string;
  protocol: string;
  positionType: string;

  // Financial (stored as string in Prisma Decimal columns)
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  realizedCashflow: string;
  unrealizedCashflow: string;
  collectedFees: string;
  unClaimedFees: string;
  lastFeesCollectedAt: Date | null;
  totalApr: number | null;

  // Price range (stored as string in Prisma Decimal columns)
  priceRangeLower: string;
  priceRangeUpper: string;

  // Lifecycle
  positionOpenedAt: Date;
  positionClosedAt: Date | null;
  isActive: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result object for position list queries
 *
 * Contains position rows plus metadata for pagination.
 */
export interface PositionListResult {
  /**
   * Array of position rows matching the filter criteria.
   * These are flat rows with common fields only — no hydrated position instances.
   */
  positions: PositionListRow[];

  /**
   * Total count of positions matching the filter (ignoring pagination)
   */
  total: number;

  /**
   * Actual limit used (after validation)
   */
  limit: number;

  /**
   * Actual offset used (after validation)
   */
  offset: number;
}
