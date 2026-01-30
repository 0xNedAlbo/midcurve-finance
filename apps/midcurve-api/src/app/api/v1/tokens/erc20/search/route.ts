/**
 * ERC-20 Token Search Endpoint
 *
 * GET /api/v1/tokens/erc20/search - Search tokens by symbol across multiple chains
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { SearchErc20TokensQuerySchema } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getCoingeckoTokenService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/search
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/tokens/erc20/search
 *
 * Search for ERC-20 tokens by symbol across multiple chains.
 * Returns up to 10 unique token symbols with all their addresses across the requested chains.
 * Results are sorted by market cap (highest first).
 *
 * Query params:
 * - chainIds (required): Comma-separated list of EVM chain IDs (e.g., "1,42161,8453")
 * - query (required): Search query for symbol (case-insensitive partial match)
 *
 * Examples:
 * GET /api/v1/tokens/erc20/search?chainIds=1,42161,8453&query=WETH
 * GET /api/v1/tokens/erc20/search?chainIds=1&query=usd
 *
 * Returns: Array of TokenSymbolResult (max 10 unique symbols), each with all addresses
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        chainIds: searchParams.get('chainIds') || '',
        query: searchParams.get('query') || '',
      };

      // Validate query params
      const validation = SearchErc20TokensQuerySchema.safeParse(queryParams);

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

      const { chainIds, query } = validation.data;

      // Search tokens via CoingeckoTokenService
      // Returns grouped results by symbol with all addresses across chains
      const results = await getCoingeckoTokenService().searchByTextAndChains(
        query,
        chainIds,
        10 // limit to 10 unique symbols
      );

      apiLogger.info({
        requestId,
        operation: 'search',
        resourceType: 'erc20-tokens',
        chainIds,
        query,
        resultsCount: results.length,
        msg: `Token search returned ${results.length} unique symbols`,
      });

      const response = createSuccessResponse(results, {
        count: results.length,
        limit: 10,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/tokens/erc20/search', error, { requestId });

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to search tokens',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
