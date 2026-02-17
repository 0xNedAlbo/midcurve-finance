/**
 * Single Close Order Endpoint (by semantic identifier)
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Authentication: Required (session only)
 *
 * Note: PUT (create), PATCH (update), DELETE (cancel) were removed — the UI hooks
 * call the contract directly via Wagmi, and the event subscriber (ProcessCloseOrderEventsRule)
 * handles all DB writes.
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
import { serializeOnChainCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getOnChainCloseOrderService,
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
      const order = await getOnChainCloseOrderService().findByPositionAndHash(
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
      const serialized = serializeOnChainCloseOrder(order);
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
