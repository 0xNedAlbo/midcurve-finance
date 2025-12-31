/**
 * Uniswap V3 Pool Discovery Endpoint
 *
 * GET /api/v1/pools/uniswapv3/discover - Discover pools for token pair
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
  DiscoverUniswapV3PoolsQuerySchema,
} from '@midcurve/api-shared';
import { serializePoolDiscoveryResult } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PoolDiscoveryService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/pools/uniswapv3/discover
 *
 * Discovers Uniswap V3 pools for a token pair across all fee tiers.
 * Returns pools sorted by TVL with subgraph metrics.
 *
 * Query params:
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 * - tokenA (required): First token address (0x...)
 * - tokenB (required): Second token address (0x...)
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        chainId: searchParams.get('chainId'),
        tokenA: searchParams.get('tokenA'),
        tokenB: searchParams.get('tokenB'),
      };

      // Validate query params
      const validation = DiscoverUniswapV3PoolsQuerySchema.safeParse(queryParams);

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

      const { chainId, tokenA, tokenB } = validation.data;

      // Discover pools via service (returns PoolDiscoveryResult<'uniswapv3'>[])
      const results = await getUniswapV3PoolDiscoveryService().findPoolsForTokenPair({
        chainId,
        tokenA,
        tokenB,
      });

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'discovered',
        'uniswapv3-pools',
        `${chainId}-${tokenA.slice(0, 10)}-${tokenB.slice(0, 10)}`,
        {
          chainId,
          tokenA: tokenA.slice(0, 10) + '...',
          tokenB: tokenB.slice(0, 10) + '...',
          poolCount: results.length,
        }
      );

      // Serialize results (convert bigint fields to strings for JSON)
      const responseData = results.map(serializePoolDiscoveryResult);

      const response = createSuccessResponse(responseData, {
        count: results.length,
        chainId,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/pools/uniswapv3/discover', error, {
        requestId,
      });

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Address validation errors
        if (error.message.includes('Invalid') && error.message.includes('address')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.INVALID_ADDRESS,
            'Invalid token address format',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.INVALID_ADDRESS],
          });
        }

        // Chain support errors
        if (error.message.includes('not supported') || error.message.includes('not configured')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            'Chain not supported',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
          });
        }

        // Subgraph unavailable (transient network error)
        if (error.name === 'UniswapV3SubgraphUnavailableError') {
          const errorResponse = createErrorResponse(
            ApiErrorCode.SERVICE_UNAVAILABLE,
            'Uniswap V3 subgraph temporarily unavailable',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 503, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.SERVICE_UNAVAILABLE],
          });
        }

        // Subgraph API error (non-transient error from subgraph)
        if (error.name === 'UniswapV3SubgraphApiError') {
          const errorResponse = createErrorResponse(
            ApiErrorCode.EXTERNAL_SERVICE_ERROR,
            'Uniswap V3 subgraph returned an error',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.EXTERNAL_SERVICE_ERROR],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to discover pools',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
