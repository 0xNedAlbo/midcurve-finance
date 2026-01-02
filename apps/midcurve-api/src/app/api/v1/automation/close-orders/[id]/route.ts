/**
 * Automation Close Order by ID API Endpoints
 *
 * GET /api/v1/automation/close-orders/[id] - Get specific order
 * PATCH /api/v1/automation/close-orders/[id] - Update order thresholds
 * DELETE /api/v1/automation/close-orders/[id] - Cancel order
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  UpdateCloseOrderRequestSchema,
  type GetCloseOrderResponse,
  type UpdateCloseOrderResponse,
  type CancelCloseOrderResponse,
} from '@midcurve/api-shared';
import type { CloseOrderInterface } from '@midcurve/shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getAutomationContractService,
  getCloseOrderService,
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
 * Verify order ownership through contract chain
 */
async function verifyOrderOwnership(
  orderId: string,
  userId: string,
  requestId: string,
  startTime: number
): Promise<
  | { success: true; order: CloseOrderInterface }
  | { success: false; response: Response }
> {
  const closeOrderService = getCloseOrderService();
  const contractService = getAutomationContractService();

  const order = await closeOrderService.findById(orderId);

  if (!order) {
    const errorResponse = createErrorResponse(
      ApiErrorCode.NOT_FOUND,
      `Close order not found: ${orderId}`
    );
    apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
    return {
      success: false,
      response: NextResponse.json(errorResponse, { status: 404 }),
    };
  }

  // Verify ownership through contract
  const contract = await contractService.findById(order.contractId);

  if (!contract || contract.userId !== userId) {
    const errorResponse = createErrorResponse(
      ApiErrorCode.FORBIDDEN,
      'You do not have access to this order'
    );
    apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
    return {
      success: false,
      response: NextResponse.json(errorResponse, { status: 403 }),
    };
  }

  return { success: true, order };
}

/**
 * GET /api/v1/automation/close-orders/[id]
 *
 * Get a specific close order by ID.
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
        'get',
        'close-order',
        user.id,
        { orderId: id }
      );

      // Verify ownership
      const result = await verifyOrderOwnership(id, user.id, requestId, startTime);
      if (!result.success) {
        return result.response;
      }

      // Serialize and return
      const serialized = serializeCloseOrder(result.order!);
      const response: GetCloseOrderResponse = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/close-orders/[id]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve close order'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}

/**
 * PATCH /api/v1/automation/close-orders/[id]
 *
 * Update a close order's thresholds or slippage.
 * Only allowed in 'pending' or 'active' state.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { id } = await params;

      // Parse JSON body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Validate request
      const validation = UpdateCloseOrderRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const { sqrtPriceX96Lower, sqrtPriceX96Upper, slippageBps } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'update',
        'close-order',
        user.id,
        { orderId: id, sqrtPriceX96Lower, sqrtPriceX96Upper, slippageBps }
      );

      // Verify ownership
      const result = await verifyOrderOwnership(id, user.id, requestId, startTime);
      if (!result.success) {
        return result.response;
      }

      const order = result.order!;

      // Check if order is in updatable state
      const updatableStates = ['pending', 'active'];
      if (!updatableStates.includes(order.status)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CONFLICT,
          `Cannot update order in '${order.status}' state. Must be 'pending' or 'active'.`
        );
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 409 });
      }

      // Update the order
      const closeOrderService = getCloseOrderService();
      const updatedOrder = await closeOrderService.update(id, {
        sqrtPriceX96Lower: sqrtPriceX96Lower ? BigInt(sqrtPriceX96Lower) : undefined,
        sqrtPriceX96Upper: sqrtPriceX96Upper ? BigInt(sqrtPriceX96Upper) : undefined,
        slippageBps,
      });

      // Serialize and return
      const serialized = serializeCloseOrder(updatedOrder);
      const response: UpdateCloseOrderResponse = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'PATCH /api/v1/automation/close-orders/[id]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to update close order'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}

/**
 * DELETE /api/v1/automation/close-orders/[id]
 *
 * Cancel a close order.
 * Not allowed in terminal states (executed, cancelled, expired, failed).
 */
export async function DELETE(
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
        'cancel',
        'close-order',
        user.id,
        { orderId: id }
      );

      // Verify ownership
      const result = await verifyOrderOwnership(id, user.id, requestId, startTime);
      if (!result.success) {
        return result.response;
      }

      const order = result.order!;

      // Check if order is in cancellable state
      const terminalStates = ['executed', 'cancelled', 'expired', 'failed'];
      if (terminalStates.includes(order.status)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CONFLICT,
          `Cannot cancel order in '${order.status}' state. Order is already in terminal state.`
        );
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 409 });
      }

      // Cancel the order
      const closeOrderService = getCloseOrderService();
      const cancelledOrder = await closeOrderService.cancel(id);

      // TODO: Decrement pool subscription order count
      // This requires looking up the pool ID from the order's pool address
      // and calling PoolSubscriptionService.decrementOrderCount(poolId)

      // Serialize and return
      const serialized = serializeCloseOrder(cancelledOrder);
      const response: CancelCloseOrderResponse = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/automation/close-orders/[id]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to cancel close order'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
