/**
 * Close Order Status API Endpoint
 *
 * GET /api/v1/automation/close-orders/[id]/status
 *   - Poll for close order registration status
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type GetCloseOrderStatusResponse,
} from '@midcurve/api-shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getCloseOrderService,
  getUniswapV3PositionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/close-orders/[id]/status
 *
 * Poll for the registration status of a close order.
 * Always returns 200 OK - check operationStatus in body for actual status.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { id } = await params;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'poll-status',
        'close-order',
        user.id,
        { orderId: id }
      );

      // Fetch order
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findById(id);

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Close order not found: ${id}`
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      // Verify ownership through position
      const positionService = getUniswapV3PositionService();
      const position = await positionService.findById(order.positionId);

      if (!position || position.userId !== user.id) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'You do not have access to this order'
        );
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 403 });
      }

      // Map order status to operation status
      // In the new model, orders are created as 'active' (already registered on-chain)
      let operationStatus: 'pending' | 'registering' | 'completed' | 'failed';

      switch (order.status) {
        case 'pending':
          operationStatus = 'pending';
          break;
        case 'registering':
          operationStatus = 'registering';
          break;
        case 'active':
        case 'triggering':
        case 'executed':
          operationStatus = 'completed';
          break;
        case 'failed':
        case 'cancelled':
        case 'expired':
          operationStatus = 'failed';
          break;
        default:
          operationStatus = 'pending';
      }

      // Get error message if failed
      const orderState = order.state as Record<string, unknown>;
      const operationError =
        operationStatus === 'failed' && 'executionError' in orderState
          ? ((orderState.executionError as string | null) ?? undefined)
          : undefined;

      // Build response
      const response: GetCloseOrderStatusResponse = createSuccessResponse({
        id: order.id,
        closeOrderType: order.closeOrderType,
        positionId: order.positionId,
        operationStatus,
        operationError,
        order:
          operationStatus === 'completed' || operationStatus === 'failed'
            ? serializeCloseOrder(order)
            : undefined,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/close-orders/[id]/status',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve order status'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
