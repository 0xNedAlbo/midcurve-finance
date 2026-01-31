/**
 * Remove Favorite Pool Endpoint
 *
 * DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address - Remove pool from favorites
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  RemoveFavoritePoolParamsSchema,
  type RemoveFavoritePoolData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getFavoritePoolService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address
 *
 * Remove a pool from the user's favorites.
 *
 * Path params:
 * - chainId (required): Chain ID (e.g., 1, 42161, 8453)
 * - address (required): Pool contract address (0x...)
 *
 * This operation is idempotent - succeeds even if pool is not in favorites.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; address: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Await and parse path params (Next.js 15 requires Promise)
      const { chainId, address } = await params;
      const paramsResult = RemoveFavoritePoolParamsSchema.safeParse({
        chainId,
        address,
      });

      if (!paramsResult.success) {
        apiLog.validationError(apiLogger, requestId, paramsResult.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsResult.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId: validatedChainId, address: validatedAddress } = paramsResult.data;

      // 2. Remove from favorites
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'removeFavoriteByAddress',
        'FavoritePool',
        `${validatedChainId}/${validatedAddress}`,
        {
          chainId: validatedChainId,
          poolAddress: validatedAddress,
        }
      );

      const favoritePoolService = getFavoritePoolService();

      await favoritePoolService.removeFavoriteByAddress({
        userId: user.id,
        chainId: validatedChainId,
        poolAddress: validatedAddress,
      });

      // 3. Build response
      const responseData: RemoveFavoritePoolData = {
        removed: true,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address',
        error,
        {
          requestId,
        }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred'
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
