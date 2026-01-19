/**
 * Swap Tokens Endpoint
 *
 * GET /api/v1/swap/tokens - Get tokens available for swapping on a chain
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
  GetSwapTokensQuerySchema,
  isParaswapSupportedChain,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getParaswapClient } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/swap/tokens
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/swap/tokens
 *
 * Fetches the list of tokens available for swapping via ParaSwap on a given chain.
 *
 * Query params:
 * - chainId (required): EVM chain ID (must be supported by ParaSwap: 1, 42161, 8453, 10)
 *
 * Returns: Array of swap tokens with address, symbol, decimals, logoUrl
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        chainId: searchParams.get('chainId'),
      };

      // Validate query params
      const validation = GetSwapTokensQuerySchema.safeParse(queryParams);

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

      const { chainId } = validation.data;

      // Check if chain is supported by ParaSwap
      if (!isParaswapSupportedChain(chainId)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CHAIN_NOT_SUPPORTED,
          `ParaSwap does not support chain ${chainId}. Supported chains: 1, 42161, 8453, 10`
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
        });
      }

      // Fetch tokens from ParaSwap
      const client = getParaswapClient();
      const tokens = await client.getTokens(chainId);

      apiLogger.info({
        requestId,
        operation: 'list',
        resourceType: 'swap-tokens',
        chainId,
        count: tokens.length,
        msg: `Fetched ${tokens.length} swap tokens for chain ${chainId}`,
      });

      // Transform to API response format
      const responseTokens = tokens.map((token) => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoUrl: token.logoUrl,
      }));

      const response = createSuccessResponse(responseTokens, {
        chainId,
        count: responseTokens.length,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/swap/tokens', error, { requestId });

      // Handle ParaSwap API errors
      if (error instanceof Error && error.name === 'ParaswapApiError') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.EXTERNAL_SERVICE_ERROR,
          'Failed to fetch swap tokens from ParaSwap',
          error.message
        );

        apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.EXTERNAL_SERVICE_ERROR],
        });
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch swap tokens',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
