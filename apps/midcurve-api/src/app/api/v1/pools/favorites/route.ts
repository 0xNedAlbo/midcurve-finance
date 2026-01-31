/**
 * Generic Favorite Pools Endpoints (Protocol-Agnostic)
 *
 * POST /api/v1/pools/favorites - Add pool to favorites
 * GET /api/v1/pools/favorites - List favorite pools (with optional protocol filter)
 * DELETE /api/v1/pools/favorites?protocol=...&chainId=...&address=... - Remove from favorites
 *
 * These endpoints provide a protocol-agnostic way to manage favorites.
 * They delegate to the appropriate protocol-specific service based on the protocol parameter.
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
  GenericAddFavoritePoolRequestSchema,
  GenericListFavoritePoolsQuerySchema,
  type RemoveFavoritePoolData,
  type AddFavoritePoolData,
  type ListFavoritePoolsData,
  type FavoritePoolItem,
} from '@midcurve/api-shared';
import { serializeUniswapV3Pool } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getFavoritePoolService, getSubgraphClient } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/pools/favorites
 *
 * Add a pool to the user's favorites.
 *
 * Request body:
 * - protocol (required): Protocol identifier (e.g., "uniswapv3")
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

      const validation = GenericAddFavoritePoolRequestSchema.safeParse(body);
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

      const { protocol, chainId, poolAddress } = validation.data;

      // 2. Delegate to protocol-specific service
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'addFavorite',
        'FavoritePool',
        `${protocol}/${chainId}/${poolAddress}`,
        { protocol, chainId, poolAddress }
      );

      let result;
      let alreadyFavorited = false;

      switch (protocol) {
        case 'uniswapv3': {
          try {
            const favoritePoolService = getFavoritePoolService();
            result = await favoritePoolService.addFavorite({
              userId: user.id,
              chainId,
              poolAddress,
            });

            // Check if this was already favorited
            const timeDiff = Date.now() - result.createdAt.getTime();
            alreadyFavorited = timeDiff > 1000;
          } catch (error) {
            if (error instanceof Error) {
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

              if (error.message.includes('not configured') || error.message.includes('not supported')) {
                const errorResponse = createErrorResponse(ApiErrorCode.BAD_REQUEST, error.message);
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                  status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
                });
              }

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
            throw error;
          }
          break;
        }

        default: {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            `Protocol "${protocol}" is not supported`
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 400 });
        }
      }

      // 3. Fetch metrics from subgraph
      const subgraphClient = getSubgraphClient();
      const metricsMap = await subgraphClient.getPoolsMetricsBatch(chainId, [poolAddress]);
      const poolMetrics = metricsMap.get(poolAddress.toLowerCase());

      // Default metrics if subgraph data unavailable
      const metrics = poolMetrics
        ? {
            tvlUSD: poolMetrics.tvlUSD,
            volume24hUSD: poolMetrics.volume24hUSD,
            fees24hUSD: poolMetrics.fees24hUSD,
            fees7dUSD: poolMetrics.fees7dUSD,
            apr7d: poolMetrics.apr7d,
          }
        : {
            tvlUSD: '0',
            volume24hUSD: '0',
            fees24hUSD: '0',
            fees7dUSD: '0',
            apr7d: 0,
          };

      // 4. Build response
      const poolHash = `${protocol}/${chainId}/${result.pool.address}`;
      const serializedPool = serializeUniswapV3Pool(result.pool);

      const favoriteItem: FavoritePoolItem = {
        poolHash,
        chainId: result.pool.chainId,
        poolAddress: result.pool.address,
        favoritedAt: result.createdAt.toISOString(),
        pool: serializedPool as unknown as FavoritePoolItem['pool'],
        ...metrics,
      };

      const responseData: AddFavoritePoolData = {
        favorite: favoriteItem,
        alreadyFavorited,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
        protocol,
      });

      apiLog.requestEnd(apiLogger, requestId, alreadyFavorited ? 200 : 201, Date.now() - startTime);

      return NextResponse.json(response, { status: alreadyFavorited ? 200 : 201 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/pools/favorites', error, { requestId });

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
 * GET /api/v1/pools/favorites
 *
 * List the user's favorite pools.
 *
 * Query params:
 * - protocol (optional): Filter by protocol (e.g., "uniswapv3"). If omitted, returns all.
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
      const validation = GenericListFavoritePoolsQuerySchema.safeParse(searchParams);

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

      const { protocol, limit, offset } = validation.data;

      // 2. List favorites (currently only uniswapv3 supported)
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'listFavorites',
        'FavoritePool',
        `protocol=${protocol ?? 'all'}&limit=${limit}&offset=${offset}`,
        { protocol, limit, offset }
      );

      const favoritePoolService = getFavoritePoolService();

      // Get favorites - if protocol is specified, we'll filter; otherwise get all
      // Currently FavoritePoolService only handles uniswapv3, so this works
      const [favorites, total] = await Promise.all([
        favoritePoolService.listFavorites({
          userId: user.id,
          limit,
          offset,
        }),
        favoritePoolService.countFavorites(user.id),
      ]);

      // 3. Transform to response items, optionally filtering by protocol
      const favoriteItems: FavoritePoolItem[] = [];

      for (const fav of favorites) {
        const favProtocol = 'uniswapv3'; // Currently all pools are uniswapv3

        // Filter by protocol if specified
        if (protocol && protocol !== favProtocol) {
          continue;
        }

        const poolHash = `${favProtocol}/${fav.pool.chainId}/${fav.pool.address}`;
        const serializedPool = serializeUniswapV3Pool(fav.pool);

        favoriteItems.push({
          poolHash,
          chainId: fav.pool.chainId,
          poolAddress: fav.pool.address,
          favoritedAt: fav.createdAt.toISOString(),
          pool: serializedPool as unknown as FavoritePoolItem['pool'],
          // Include metrics from subgraph
          tvlUSD: fav.metrics.tvlUSD,
          volume24hUSD: fav.metrics.volume24hUSD,
          fees24hUSD: fav.metrics.fees24hUSD,
          fees7dUSD: fav.metrics.fees7dUSD,
          apr7d: fav.metrics.apr7d,
        });
      }

      // 4. Build response
      const responseData: ListFavoritePoolsData = {
        favorites: favoriteItems,
        total: protocol ? favoriteItems.length : total, // Adjust total if filtering
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
        count: favoriteItems.length,
        limit,
        offset,
        protocol: protocol ?? 'all',
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/pools/favorites', error, { requestId });

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

        default: {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            `Protocol "${protocol}" is not supported`
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 400 });
        }
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
      apiLog.methodError(apiLogger, 'DELETE /api/v1/pools/favorites', error, { requestId });

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
