/**
 * Generic Favorite Pools Endpoint (Protocol-Agnostic)
 *
 * DELETE /api/v1/pools/favorites?protocol=...&chainId=...&address=... - Remove pool from favorites
 *
 * This endpoint provides a protocol-agnostic way to manage favorites.
 * It delegates to the appropriate protocol-specific service based on the protocol parameter.
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
  RemoveFavoritePoolQuerySchema,
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
 * DELETE /api/v1/pools/favorites?protocol=...&chainId=...&address=...
 *
 * Remove a pool from the user's favorites using a protocol-agnostic endpoint.
 *
 * Query params:
 * - protocol (required): Protocol identifier (e.g., "uniswapv3")
 * - chainId (required): Chain ID (e.g., 1, 42161, 8453)
 * - address (required): Pool contract address (0x...)
 *
 * This operation is idempotent - succeeds even if pool is not in favorites.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const validation = RemoveFavoritePoolQuerySchema.safeParse(searchParams);

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

      const { protocol, chainId, address } = validation.data;

      // 2. Delegate to protocol-specific service
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'removeFavorite',
        'FavoritePool',
        `${protocol}/${chainId}/${address}`,
        {
          protocol,
          chainId,
          poolAddress: address,
        }
      );

      // Route to appropriate service based on protocol
      switch (protocol) {
        case 'uniswapv3': {
          const favoritePoolService = getFavoritePoolService();
          await favoritePoolService.removeFavoriteByAddress({
            userId: user.id,
            chainId,
            poolAddress: address,
          });
          break;
        }

        // Future protocols can be added here:
        // case 'orca':
        // case 'pancakeswap':
        //   await getOrcaFavoriteService().removeFavorite(...)
        //   break;

        default:
          // This shouldn't happen since schema validates protocol,
          // but TypeScript exhaustiveness check benefits from this
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            `Protocol "${protocol}" is not supported`
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 400 });
      }

      // 3. Build response
      const responseData: RemoveFavoritePoolData = {
        removed: true,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
        protocol,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/pools/favorites',
        error,
        { requestId }
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
