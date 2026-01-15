/**
 * Position PnL Curve Endpoint
 *
 * GET /api/v1/positions/:positionId/pnl-curve
 *
 * Returns PnL curve data points for a position, optionally including
 * the effects of automated close orders (stop-loss, take-profit).
 *
 * The curve shows position value and PnL across a range of prices:
 * - positionValue: Raw position value at each price point
 * - adjustedValue: Value considering order effects (flattens at trigger prices)
 * - pnl/adjustedPnl: Profit/loss relative to cost basis
 *
 * Order Effects:
 * - Stop-Loss (LOWER trigger): Curve flattens at SL value for prices below trigger
 * - Take-Profit (UPPER trigger): Curve flattens at TP value for prices above trigger
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  PnLCurvePathParamsSchema,
  PnLCurveQueryParamsSchema,
} from '@midcurve/api-shared';
import type {
  PnLCurveResponse,
  PnLCurveResponseData,
  PnLCurvePointData,
  PnLCurveOrderData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getPnLCurveService } from '@/lib/services';
import { prisma } from '@midcurve/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createPreflightResponse(origin);
}

/**
 * GET /api/v1/positions/:positionId/pnl-curve
 *
 * Fetch PnL curve data for a position.
 *
 * Features:
 * - Generates curve points across a configurable price range
 * - Includes automated order effects (stop-loss, take-profit)
 * - Returns both raw and adjusted values for visualization
 * - Ensures users can only access curves for their own positions
 *
 * Path parameters:
 * - positionId: Database position ID (CUID)
 *
 * Query parameters:
 * - priceMin: Minimum price for visualization (optional)
 * - priceMax: Maximum price for visualization (optional)
 * - numPoints: Number of curve points, 10-500 (default: 150)
 * - includeOrders: Whether to include order effects (default: true)
 *
 * Returns: PnL curve data with position metadata, orders, and curve points
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const pathValidation = PnLCurvePathParamsSchema.safeParse(resolvedParams);

      if (!pathValidation.success) {
        apiLog.validationError(apiLogger, requestId, pathValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          pathValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { positionId } = pathValidation.data;

      // 2. Parse and validate query parameters
      const url = new URL(request.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());
      const queryValidation = PnLCurveQueryParamsSchema.safeParse(queryParams);

      if (!queryValidation.success) {
        apiLog.validationError(apiLogger, requestId, queryValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          queryValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { priceMin, priceMax, numPoints, includeOrders } = queryValidation.data;

      // 3. Verify position exists and belongs to user
      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionId, {
        userId: user.id,
      });

      const dbPosition = await prisma.position.findUnique({
        where: { id: positionId },
        select: { id: true, userId: true, protocol: true },
      });

      if (!dbPosition) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No position found with ID ${positionId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      // Verify ownership
      if (dbPosition.userId !== user.id) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'Access denied',
          'You do not have permission to access this position'
        );

        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
        });
      }

      // 4. Generate PnL curve
      apiLog.businessOperation(apiLogger, requestId, 'generate-pnl-curve', 'position', positionId, {
        priceMin,
        priceMax,
        numPoints,
        includeOrders,
      });

      const curveData = await getPnLCurveService().generate({
        positionId,
        priceMin: priceMin ? BigInt(priceMin) : undefined,
        priceMax: priceMax ? BigInt(priceMax) : undefined,
        numPoints,
        includeOrders: includeOrders ?? true,
      });

      apiLog.businessOperation(apiLogger, requestId, 'pnl-curve-generated', 'position', positionId, {
        pointCount: curveData.curve.length,
        orderCount: curveData.orders.length,
      });

      // 5. Serialize bigints to strings for JSON
      const serializedData: PnLCurveResponseData = {
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

      const response: PnLCurveResponse = {
        ...createSuccessResponse(serializedData),
        meta: {
          timestamp: new Date().toISOString(),
          pointCount: curveData.curve.length,
          orderCount: curveData.orders.length,
          requestId,
        },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/:positionId/pnl-curve',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Position not found
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }

        // Unsupported protocol
        if (error.message.includes('Unsupported protocol')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.VALIDATION_ERROR,
            'Unsupported protocol',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to generate PnL curve',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
