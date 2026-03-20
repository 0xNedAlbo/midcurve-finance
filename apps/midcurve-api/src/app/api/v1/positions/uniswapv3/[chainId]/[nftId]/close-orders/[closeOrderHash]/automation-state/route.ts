/**
 * Close Order Automation State Endpoint
 *
 * PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash/automation-state
 *
 * User-initiated monitoring state control (pause/resume).
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
  SetAutomationStateBodySchema,
} from '@midcurve/api-shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getUniswapV3CloseOrderService,
  getUniswapV3PositionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

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
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash/automation-state
 *
 * Set automation state for a close order (monitoring or paused).
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

      // 2. Parse and validate body
      const body = await request.json();
      const bodyValidation = SetAutomationStateBodySchema.safeParse(body);

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

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;
      const { automationState } = bodyValidation.data;

      // 3. Find position by positionHash, verify ownership
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
      const order = await getUniswapV3CloseOrderService().findByPositionAndHash(
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

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'update',
        'close-order-automation-state',
        closeOrderHash,
        { chainId, nftId, positionId: position.id, targetState: automationState }
      );

      // 5. Set automation state
      const updated = await getUniswapV3CloseOrderService().setAutomationState(
        order.id,
        automationState
      );

      // 6. Serialize and return
      const serialized = serializeCloseOrder(updated);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash/automation-state',
        error,
        { requestId }
      );

      // Return 400 for invalid state transitions, 500 for everything else
      const isValidationError = error instanceof Error && error.message.includes('Cannot set automation state');

      const errorResponse = createErrorResponse(
        isValidationError ? ApiErrorCode.VALIDATION_ERROR : ApiErrorCode.INTERNAL_SERVER_ERROR,
        isValidationError ? 'Invalid state transition' : 'Failed to update automation state',
        error instanceof Error ? error.message : String(error)
      );

      const status = isValidationError
        ? ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR]
        : ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR];

      apiLog.requestEnd(apiLogger, requestId, status, Date.now() - startTime);

      return NextResponse.json(errorResponse, { status });
    }
  });
}
