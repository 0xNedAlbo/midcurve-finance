/**
 * Single Close Order Endpoint (by semantic identifier)
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 * PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  CloseOrderHashSchema,
} from '@midcurve/api-shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getCloseOrderService,
  getUniswapV3PositionService,
  getPoolSubscriptionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { isValidCloseOrderHash } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Path params schema
 */
const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  nftId: z.string().regex(/^\d+$/).transform(Number),
  closeOrderHash: CloseOrderHashSchema,
});

/**
 * Update close order request schema
 */
const UpdateCloseOrderRequestSchema = z
  .object({
    sqrtPriceX96Lower: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Lower must be a valid bigint string')
      .optional(),
    sqrtPriceX96Upper: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Upper must be a valid bigint string')
      .optional(),
    slippageBps: z
      .number()
      .int('Slippage must be an integer')
      .min(0, 'Slippage cannot be negative')
      .max(10000, 'Slippage cannot exceed 100%')
      .optional(),
  })
  .refine(
    (data) =>
      data.sqrtPriceX96Lower || data.sqrtPriceX96Upper || data.slippageBps !== undefined,
    { message: 'At least one field must be provided for update' }
  );

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Get a specific close order by its semantic identifier.
 *
 * Path parameters:
 * - chainId: EVM chain ID
 * - nftId: Uniswap V3 NFT token ID
 * - closeOrderHash: Semantic identifier (e.g., "sl@-12345", "tp@201120")
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const paramsValidation = PathParamsSchema.safeParse(resolvedParams);

      if (!paramsValidation.success) {
        apiLog.validationError(apiLogger, requestId, paramsValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Find position by positionHash
      const positionHash = `uniswapv3/${chainId}/${nftId}`;
      const position = await getUniswapV3PositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!position) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No Uniswap V3 position found for chainId ${chainId} and nftId ${nftId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id }
      );

      // 3. Find close order by position + hash
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 4. Serialize and return
      const serialized = serializeCloseOrder(order);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Update a close order's configuration (slippage, price thresholds).
 * Only allowed when order is in 'pending' or 'active' status.
 */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const paramsValidation = PathParamsSchema.safeParse(resolvedParams);

      if (!paramsValidation.success) {
        apiLog.validationError(apiLogger, requestId, paramsValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Parse request body
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

      const bodyValidation = UpdateCloseOrderRequestSchema.safeParse(body);
      if (!bodyValidation.success) {
        apiLog.validationError(apiLogger, requestId, bodyValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          bodyValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 3. Find position by positionHash
      const positionHash = `uniswapv3/${chainId}/${nftId}`;
      const position = await getUniswapV3PositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!position) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No Uniswap V3 position found for chainId ${chainId} and nftId ${nftId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      // 4. Find close order by position + hash
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 5. Validate state allows updates
      if (order.status !== 'pending' && order.status !== 'active') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_REQUEST,
          `Cannot update order in '${order.status}' status. Only 'pending' or 'active' orders can be updated.`
        );

        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

        return NextResponse.json(errorResponse, { status: 409 });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'update',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id, orderId: order.id }
      );

      // 6. Update order (use internal id)
      const updateData = bodyValidation.data;
      const updatedOrder = await closeOrderService.update(order.id, {
        sqrtPriceX96Lower: updateData.sqrtPriceX96Lower
          ? BigInt(updateData.sqrtPriceX96Lower)
          : undefined,
        sqrtPriceX96Upper: updateData.sqrtPriceX96Upper
          ? BigInt(updateData.sqrtPriceX96Upper)
          : undefined,
        slippageBps: updateData.slippageBps,
      });

      // 7. Serialize and return
      const serialized = serializeCloseOrder(updatedOrder);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to update close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Cancel a close order.
 * Not allowed when order is in terminal state (executed, cancelled, expired, failed).
 */
export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const paramsValidation = PathParamsSchema.safeParse(resolvedParams);

      if (!paramsValidation.success) {
        apiLog.validationError(apiLogger, requestId, paramsValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Find position by positionHash
      const positionHash = `uniswapv3/${chainId}/${nftId}`;
      const position = await getUniswapV3PositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!position) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No Uniswap V3 position found for chainId ${chainId} and nftId ${nftId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      // 3. Find close order by position + hash
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 4. Validate state allows cancellation
      const terminalStates = ['executed', 'cancelled', 'expired', 'failed'];
      if (terminalStates.includes(order.status)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_REQUEST,
          `Cannot cancel order in '${order.status}' status. Order is already in a terminal state.`
        );

        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

        return NextResponse.json(errorResponse, { status: 409 });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'cancel',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id, orderId: order.id }
      );

      // 5. Cancel order (use internal id)
      const cancelledOrder = await closeOrderService.cancel(order.id);

      // 6. Decrement pool subscription count
      try {
        const subscriptionService = getPoolSubscriptionService();
        await subscriptionService.decrementOrderCount(position.pool.id);
      } catch (subError) {
        // Log but don't fail the request
        apiLogger.warn({
          requestId,
          poolId: position.pool.id,
          error: subError instanceof Error ? subError.message : String(subError),
          msg: 'Failed to decrement pool subscription count',
        });
      }

      // 7. Serialize and return
      const serialized = serializeCloseOrder(cancelledOrder);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to cancel close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
