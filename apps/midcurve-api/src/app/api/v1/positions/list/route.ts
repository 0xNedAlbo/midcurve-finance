/**
 * Generic Position List Endpoint
 *
 * GET /api/v1/positions/list
 *
 * Returns common position fields for sorting/filtering and positionHash for
 * protocol dispatch. No protocol-specific data, no pool/token objects,
 * no PnL curves. Each card fetches its own detail data.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createErrorResponse,
  createPaginatedResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { ListPositionsQuerySchema } from '@midcurve/api-shared';
import type { ListPositionsResponse, PositionListItem } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getPositionListService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import type { PositionListRow } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * Serialize a PositionListRow (from service) to a PositionListItem (for API response).
 * Converts Date fields to ISO strings. Bigint fields are already strings from Prisma.
 */
function serializeListRow(row: PositionListRow): PositionListItem {
  return {
    positionHash: row.positionHash,
    protocol: row.protocol,
    positionType: row.positionType,
    currentValue: row.currentValue,
    currentCostBasis: row.currentCostBasis,
    realizedPnl: row.realizedPnl,
    unrealizedPnl: row.unrealizedPnl,
    realizedCashflow: row.realizedCashflow,
    unrealizedCashflow: row.unrealizedCashflow,
    collectedFees: row.collectedFees,
    unClaimedFees: row.unClaimedFees,
    lastFeesCollectedAt: row.lastFeesCollectedAt?.toISOString() ?? null,
    totalApr: row.totalApr,
    priceRangeLower: row.priceRangeLower,
    priceRangeUpper: row.priceRangeUpper,
    positionOpenedAt: row.positionOpenedAt.toISOString(),
    positionClosedAt: row.positionClosedAt?.toISOString() ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * GET /api/v1/positions/list
 *
 * List user's positions across all protocols with pagination, filtering, and sorting.
 * Returns common fields + positionHash for protocol dispatch.
 *
 * Query parameters:
 * - protocols (optional): Comma-separated protocol list (e.g., 'uniswapv3,orca')
 * - status (optional): Filter by status ('active', 'closed', 'all') - default: 'all'
 * - sortBy (optional): Sort field ('createdAt', 'positionOpenedAt', 'currentValue', 'totalApr') - default: 'createdAt'
 * - sortDirection (optional): Sort direction ('asc', 'desc') - default: 'desc'
 * - limit (optional): Results per page (1-100, default: 20)
 * - offset (optional): Pagination offset (>=0, default: 0)
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        protocols: searchParams.get('protocols') ?? undefined,
        status: searchParams.get('status') ?? undefined,
        sortBy: searchParams.get('sortBy') ?? undefined,
        sortDirection: searchParams.get('sortDirection') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        offset: searchParams.get('offset') ?? undefined,
      };

      const validation = ListPositionsQuerySchema.safeParse(queryParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { protocols, status, sortBy, sortDirection, limit, offset } =
        validation.data;

      apiLog.businessOperation(apiLogger, requestId, 'list', 'positions', user.id, {
        protocols,
        status,
        sortBy,
        sortDirection,
        limit,
        offset,
      });

      // 2. Query positions from service (flat rows, no joins)
      const result = await getPositionListService().list(user.id, {
        protocols,
        status,
        sortBy,
        sortDirection,
        limit,
        offset,
      });

      // 3. Serialize rows (Date → ISO string conversion)
      const serializedPositions: PositionListItem[] = result.positions.map(serializeListRow);

      // 4. Create paginated response
      const response: ListPositionsResponse = {
        ...createPaginatedResponse(
          serializedPositions,
          result.total,
          result.limit,
          result.offset
        ),
        meta: {
          timestamp: new Date().toISOString(),
          filters: {
            ...(protocols && protocols.length > 0 && { protocols }),
            status,
            sortBy,
            sortDirection,
          },
        },
      };

      apiLogger.info(
        {
          requestId,
          count: result.positions.length,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.limit < result.total,
        },
        'Positions retrieved successfully'
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/list',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve positions',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
