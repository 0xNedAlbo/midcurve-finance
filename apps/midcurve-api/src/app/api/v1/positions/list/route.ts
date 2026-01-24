/**
 * Generic Position List Endpoint
 *
 * GET /api/v1/positions/list
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
import type { UniswapV3Position } from '@midcurve/shared';
import { serializeUniswapV3Position } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import type { ListPositionsResponse, ListPositionData, PnLCurveResponseData, PnLCurvePointData, PnLCurveOrderData } from '@midcurve/api-shared';
import { getPositionListService, getPnLCurveService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

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
        includePnLCurve: searchParams.get('includePnLCurve') ?? undefined,
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

      const { protocols, status, sortBy, sortDirection, limit, offset, includePnLCurve } =
        validation.data;

      apiLog.businessOperation(apiLogger, requestId, 'list', 'positions', user.id, {
        protocols,
        status,
        sortBy,
        sortDirection,
        limit,
        offset,
        includePnLCurve,
      });

      // 2. Query positions from service (now includes aprPeriods in DB query)
      const result = await getPositionListService().list(user.id, {
        protocols,
        status,
        sortBy,
        sortDirection,
        limit,
        offset,
      });

      // 3. Serialize positions for JSON response
      // No need to fetch aprPeriods - totalApr is already calculated and stored in Position
      // This reduces payload size by 80-95% for APR data

      const serializedPositions: ListPositionData[] = [];

      for (const position of result.positions) {
        // Currently only Uniswap V3 is supported
        // Cast to UniswapV3Position for proper serialization
        const serializedPosition = serializeUniswapV3Position(position as UniswapV3Position);

        const positionData = serializedPosition as unknown as ListPositionData;

        // Generate PnL curve if requested
        if (includePnLCurve) {
          try {
            const curveData = await getPnLCurveService().generate({
              positionId: position.id,
              numPoints: 100, // Compact curve for mini display
              includeOrders: true,
            });

            // Serialize curve data for JSON response
            const serializedCurve: PnLCurveResponseData = {
              positionId: curveData.positionId,
              tickLower: curveData.tickLower,
              tickUpper: curveData.tickUpper,
              liquidity: curveData.liquidity.toString(),
              costBasis: curveData.costBasis.toString(),
              baseToken: curveData.baseToken,
              quoteToken: curveData.quoteToken,
              currentPrice: curveData.currentPrice.toString(),
              currentTick: curveData.currentTick,
              lowerPrice: curveData.lowerPrice.toString(),
              upperPrice: curveData.upperPrice.toString(),
              orders: curveData.orders.map((order): PnLCurveOrderData => ({
                type: order.type,
                triggerPrice: order.triggerPrice.toString(),
                triggerTick: order.triggerTick,
                status: order.status,
                valueAtTrigger: order.valueAtTrigger.toString(),
              })),
              curve: curveData.curve.map((point): PnLCurvePointData => ({
                price: point.price.toString(),
                positionValue: point.positionValue.toString(),
                adjustedValue: point.adjustedValue.toString(),
                pnl: point.pnl.toString(),
                adjustedPnl: point.adjustedPnl.toString(),
                pnlPercent: point.pnlPercent,
                adjustedPnlPercent: point.adjustedPnlPercent,
                phase: point.phase,
                orderTriggered: point.orderTriggered,
              })),
            };

            positionData.pnlCurve = serializedCurve;
          } catch (curveError) {
            // Log error but don't fail the entire request
            apiLogger.warn(
              { requestId, positionId: position.id, error: curveError },
              'Failed to generate PnL curve for position'
            );
            // Leave pnlCurve undefined for this position
          }
        }

        serializedPositions.push(positionData);
      }

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
          includePnLCurve,
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
