/**
 * Uniswap V3 Pool Search Endpoint
 *
 * POST /api/v1/pools/uniswapv3/search - Search pools by token sets
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
  PoolSearchRequestSchema,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PoolSearchService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/pools/uniswapv3/search
 *
 * Searches for Uniswap V3 pools matching the given token sets across multiple chains.
 * Returns pools sorted by TVL with 7-day APR calculation.
 *
 * Request body:
 * - tokenSetA (required): Array of token addresses or symbols
 * - tokenSetB (required): Array of token addresses or symbols
 * - chainIds (required): Array of chain IDs to search
 * - sortBy (optional): Field to sort by (tvlUSD, volume24hUSD, fees24hUSD, apr7d)
 * - sortDirection (optional): Sort direction (asc, desc)
 * - limit (optional): Maximum results to return (1-100, default: 20)
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Validate request body
      const validation = PoolSearchRequestSchema.safeParse(body);

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

      const { tokenSetA, tokenSetB, chainIds, sortBy, sortDirection, limit } = validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'searching',
        'uniswapv3-pools',
        `${chainIds.join(',')}-${tokenSetA.length}x${tokenSetB.length}`,
        {
          tokenSetA,
          tokenSetB,
          chainIds,
          sortBy,
          limit,
        }
      );

      // Search pools via service
      const results = await getUniswapV3PoolSearchService().searchPools({
        tokenSetA,
        tokenSetB,
        chainIds,
        sortBy,
        sortDirection,
        limit,
      });

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'searched',
        'uniswapv3-pools',
        `found-${results.length}`,
        {
          poolCount: results.length,
          chainIds,
          sortBy,
        }
      );

      // Build response
      const response = createSuccessResponse(results, {
        totalFound: results.length,
        count: results.length,
        sortBy,
        sortDirection,
        chainIds,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/pools/uniswapv3/search', error, {
        requestId,
      });

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Chain support errors
        if (error.message.includes('not supported') || error.message.includes('not configured')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            'One or more chains not supported',
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
        'Failed to search pools',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
