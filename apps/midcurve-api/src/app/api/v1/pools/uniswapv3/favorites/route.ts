/**
 * Favorite Pools Endpoints
 *
 * POST /api/v1/pools/uniswapv3/favorites - Add pool to favorites
 * GET /api/v1/pools/uniswapv3/favorites - List favorite pools
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
  AddFavoritePoolRequestSchema,
  ListFavoritePoolsQuerySchema,
  type AddFavoritePoolData,
  type ListFavoritePoolsData,
  type FavoritePoolItem,
} from '@midcurve/api-shared';
import { serializeUniswapV3Pool } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getFavoritePoolService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/pools/uniswapv3/favorites
 *
 * Add a pool to the user's favorites.
 *
 * Request body:
 * - chainId (required): Chain ID (e.g., 1, 42161, 8453)
 * - poolAddress (required): Pool contract address (0x...)
 *
 * Returns the favorited pool with full pool data.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate request body
      let body;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const validation = AddFavoritePoolRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, poolAddress } = validation.data;

      // 2. Add to favorites
      apiLog.businessOperation(apiLogger, requestId, 'addFavorite', 'FavoritePool', `${chainId}/${poolAddress}`, {
        chainId,
        poolAddress,
      });

      const favoritePoolService = getFavoritePoolService();
      let result;
      let alreadyFavorited = false;

      try {
        result = await favoritePoolService.addFavorite({
          userId: user.id,
          chainId,
          poolAddress,
        });

        // Check if this was already favorited (createdAt would be older)
        const timeDiff = Date.now() - result.createdAt.getTime();
        alreadyFavorited = timeDiff > 1000; // More than 1 second old = already existed
      } catch (error) {
        if (error instanceof Error) {
          // Pool not found or not a valid Uniswap V3 pool
          if (
            error.message.includes('Invalid pool address') ||
            error.message.includes('does not implement')
          ) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.NOT_FOUND,
              `Pool not found at address ${poolAddress} on chain ${chainId}`
            );

            apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
            });
          }

          // Chain not supported
          if (error.message.includes('not configured') || error.message.includes('not supported')) {
            const errorResponse = createErrorResponse(ApiErrorCode.BAD_REQUEST, error.message);

            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
            });
          }

          // RPC or on-chain read failure
          if (error.message.includes('Failed to read')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.BAD_GATEWAY,
              'Failed to read pool data from blockchain',
              error.message
            );

            apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_GATEWAY],
            });
          }
        }

        // Unknown error
        throw error;
      }

      // 3. Build pool hash
      const poolHash = `uniswapv3/${chainId}/${result.pool.address}`;

      // 4. Serialize pool for response
      const serializedPool = serializeUniswapV3Pool(result.pool);

      // 5. Build favorite item
      const favoriteItem: FavoritePoolItem = {
        poolHash,
        chainId: result.pool.chainId,
        poolAddress: result.pool.address,
        favoritedAt: result.createdAt.toISOString(),
        pool: serializedPool as unknown as FavoritePoolItem['pool'],
      };

      // 6. Build response
      const responseData: AddFavoritePoolData = {
        favorite: favoriteItem,
        alreadyFavorited,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, alreadyFavorited ? 200 : 201, Date.now() - startTime);

      return NextResponse.json(response, { status: alreadyFavorited ? 200 : 201 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(apiLogger, 'POST /api/v1/pools/uniswapv3/favorites', error, {
        requestId,
      });

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

/**
 * GET /api/v1/pools/uniswapv3/favorites
 *
 * List the user's favorite pools.
 *
 * Query params:
 * - limit (optional): Maximum results (default: 50, max: 100)
 * - offset (optional): Pagination offset (default: 0)
 *
 * Returns array of favorite pools ordered by favorited time (most recent first).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const validation = ListFavoritePoolsQuerySchema.safeParse(searchParams);

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

      const { limit, offset } = validation.data;

      // 2. List favorites
      apiLog.businessOperation(apiLogger, requestId, 'listFavorites', 'FavoritePool', `limit=${limit}&offset=${offset}`, {
        limit,
        offset,
      });

      const favoritePoolService = getFavoritePoolService();

      const [favorites, total] = await Promise.all([
        favoritePoolService.listFavorites({
          userId: user.id,
          limit,
          offset,
        }),
        favoritePoolService.countFavorites(user.id),
      ]);

      // 3. Transform to response items
      const favoriteItems: FavoritePoolItem[] = favorites.map((fav) => {
        const poolHash = `uniswapv3/${fav.pool.chainId}/${fav.pool.address}`;
        const serializedPool = serializeUniswapV3Pool(fav.pool);

        return {
          poolHash,
          chainId: fav.pool.chainId,
          poolAddress: fav.pool.address,
          favoritedAt: fav.createdAt.toISOString(),
          pool: serializedPool as unknown as FavoritePoolItem['pool'],
        };
      });

      // 4. Build response
      const responseData: ListFavoritePoolsData = {
        favorites: favoriteItems,
        total,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
        count: favoriteItems.length,
        limit,
        offset,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(apiLogger, 'GET /api/v1/pools/uniswapv3/favorites', error, {
        requestId,
      });

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
