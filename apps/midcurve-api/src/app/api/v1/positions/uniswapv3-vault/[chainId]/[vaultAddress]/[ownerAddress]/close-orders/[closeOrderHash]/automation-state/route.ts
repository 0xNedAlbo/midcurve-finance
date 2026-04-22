/**
 * Vault Close Order Automation State Endpoint
 *
 * PATCH /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/close-orders/:closeOrderHash/automation-state
 *
 * User-initiated monitoring state control (pause/resume) for vault close orders.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/middleware/with-auth';
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
  getUniswapV3VaultPositionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  vaultAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  closeOrderHash: CloseOrderHashSchema,
});

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; vaultAddress: string; ownerAddress: string; closeOrderHash: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const paramsValidation = PathParamsSchema.safeParse(resolvedParams);

      if (!paramsValidation.success) {
        apiLog.validationError(apiLogger, requestId, paramsValidation.error.errors);
        const errorResponse = createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid path parameters', paramsValidation.error.errors);
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] });
      }

      const body = await request.json();
      const bodyValidation = SetAutomationStateBodySchema.safeParse(body);

      if (!bodyValidation.success) {
        apiLog.validationError(apiLogger, requestId, bodyValidation.error.errors);
        const errorResponse = createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid request body', bodyValidation.error.errors);
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] });
      }

      const { chainId, vaultAddress, ownerAddress, closeOrderHash } = paramsValidation.data;
      const { automationState } = bodyValidation.data;

      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;
      const position = await getUniswapV3VaultPositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!position) {
        const errorResponse = createErrorResponse(ApiErrorCode.POSITION_NOT_FOUND, 'Vault position not found',
          `No vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`);
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND] });
      }

      const order = await getUniswapV3CloseOrderService().findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(ApiErrorCode.NOT_FOUND, 'Close order not found',
          `No close order found with hash ${closeOrderHash}`);
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] });
      }

      apiLog.businessOperation(apiLogger, requestId, 'update', 'close-order-automation-state', closeOrderHash,
        { chainId, vaultAddress, positionId: position.id, targetState: automationState });

      const updated = await getUniswapV3CloseOrderService().setAutomationState(order.id, automationState);

      const serialized = serializeCloseOrder(updated);
      const response = createSuccessResponse(serialized);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger,
        'PATCH /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/close-orders/:closeOrderHash/automation-state',
        error, { requestId });

      const isValidationError = error instanceof Error && error.message.includes('Cannot set automation state');
      const errorResponse = createErrorResponse(
        isValidationError ? ApiErrorCode.VALIDATION_ERROR : ApiErrorCode.INTERNAL_SERVER_ERROR,
        isValidationError ? 'Invalid state transition' : 'Failed to update automation state',
        error instanceof Error ? error.message : String(error));

      const status = isValidationError
        ? ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR]
        : ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR];

      apiLog.requestEnd(apiLogger, requestId, status, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status });
    }
  });
}
