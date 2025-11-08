/**
 * Generic Position List Endpoint
 *
 * GET /api/v1/positions/list
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { PositionListService } from '@midcurve/services';
import {
  createErrorResponse,
  createPaginatedResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { ListPositionsQuerySchema } from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import type { ListPositionsResponse, ListPositionData } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const positionListService = new PositionListService();

/**
 * GET /api/v1/positions/list
 *
 * List user's positions across all protocols with pagination, filtering, and sorting.
 *
 * Features:
 * - Cross-protocol support (Uniswap V3, Orca, Raydium, etc.)
 * - Filter by protocol(s)
 * - Filter by position status (active/closed/all)
 * - Sorting by multiple fields
 * - Offset-based pagination
 *
 * Query parameters:
 * - protocols (optional): Comma-separated protocol list (e.g., 'uniswapv3,orca')
 * - status (optional): Filter by status ('active', 'closed', 'all') - default: 'all'
 * - sortBy (optional): Sort field ('createdAt', 'positionOpenedAt', 'currentValue', 'unrealizedPnl') - default: 'createdAt'
 * - sortDirection (optional): Sort direction ('asc', 'desc') - default: 'desc'
 * - limit (optional): Results per page (1-100, default: 20)
 * - offset (optional): Pagination offset (>=0, default: 0)
 *
 * Returns: Paginated list of positions with full pool and token details
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "uuid",
 *       "protocol": "uniswapv3",
 *       "currentValue": "1500000000",
 *       "pool": {
 *         "token0": { "symbol": "USDC", ... },
 *         "token1": { "symbol": "WETH", ... },
 *         ...
 *       },
 *       ...
 *     }
 *   ],
 *   "pagination": {
 *     "total": 150,
 *     "limit": 20,
 *     "offset": 0,
 *     "hasMore": true
 *   },
 *   "meta": {
 *     "timestamp": "2025-01-15T...",
 *     "filters": {
 *       "protocols": ["uniswapv3"],
 *       "status": "active",
 *       "sortBy": "createdAt",
 *       "sortDirection": "desc"
 *     }
 *   }
 * }
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
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

      // 2. Query positions from service
      const result = await positionListService.list(user.id, {
        protocols,
        status,
        sortBy,
        sortDirection,
        limit,
        offset,
      });

      // 3. Serialize bigints to strings for JSON
      const serializedPositions = result.positions.map((position) =>
        serializeBigInt(position)
      ) as ListPositionData[];

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
