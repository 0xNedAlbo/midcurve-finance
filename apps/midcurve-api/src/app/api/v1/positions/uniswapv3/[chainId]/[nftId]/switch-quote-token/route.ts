/**
 * Switch Quote Token Endpoint
 *
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/switch-quote-token
 *
 * Flips the quote/base token assignment for a position and completely
 * rebuilds the ledger with the new orientation. All financial metrics
 * (PnL, fees, cost basis, APR) are recalculated in terms of the new
 * quote token.
 *
 * This is a long-running operation (up to 60 seconds) because it
 * triggers a full ledger rebuild from blockchain data.
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
import { LedgerPathParamsSchema } from '@midcurve/api-shared';
import type { UniswapV3PositionResponse } from '@midcurve/api-shared';
import { serializeUniswapV3Position } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createPreflightResponse(origin);
}

/**
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/switch-quote-token
 *
 * Switch the quote/base token assignment and rebuild the position ledger.
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Updated position with recalculated metrics
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const validation = LedgerPathParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = validation.data;

      // 2. Generate position hash and look up position
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
      });

      const dbPosition = await getUniswapV3PositionService().findByPositionHash(user.id, positionHash);

      if (!dbPosition) {
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

      apiLog.businessOperation(apiLogger, requestId, 'switch-quote-token-start', 'position', dbPosition.id, {
        chainId,
        nftId,
        positionHash,
        currentIsToken0Quote: dbPosition.isToken0Quote,
      });

      // 3. Switch quote token and rebuild ledger
      const position = await getUniswapV3PositionService().switchQuoteToken(dbPosition.id);

      apiLog.businessOperation(apiLogger, requestId, 'switch-quote-token-complete', 'position', position.id, {
        chainId,
        nftId,
        isToken0Quote: position.isToken0Quote,
        currentValue: position.currentValue.toString(),
        unrealizedPnl: position.unrealizedPnl.toString(),
      });

      // 4. Serialize bigints to strings for JSON
      const serializedPosition = serializeUniswapV3Position(position) as UniswapV3PositionResponse;

      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/uniswapv3/:chainId/:nftId/switch-quote-token',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Chain not supported
        if (
          error.message.includes('not configured') ||
          error.message.includes('not supported')
        ) {
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

        // Position not found
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }

        // Rate limit
        if (
          error.message.includes('rate limit') ||
          error.message.includes('too many requests')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.TOO_MANY_REQUESTS,
            'Rate limit exceeded',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 429, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.TOO_MANY_REQUESTS],
          });
        }

        // On-chain read failures
        if (
          error.message.includes('Failed to read') ||
          error.message.includes('contract') ||
          error.message.includes('RPC')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            'Failed to fetch data from blockchain',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to switch quote token',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
