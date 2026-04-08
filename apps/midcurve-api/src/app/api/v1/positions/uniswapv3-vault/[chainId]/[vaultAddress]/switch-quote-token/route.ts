/**
 * Vault Position Switch Quote Token Endpoint
 *
 * POST /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/switch-quote-token
 *
 * Flips the quote/base token assignment and rebuilds the ledger.
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
  GetUniswapV3VaultPositionParamsSchema,
} from '@midcurve/api-shared';
import type { UniswapV3VaultPositionResponse } from '@midcurve/api-shared';
import { serializeUniswapV3VaultPosition } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3VaultPositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; vaultAddress: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const validation = GetUniswapV3VaultPositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid path parameters', validation.error.errors);
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] });
      }

      const { chainId, vaultAddress } = validation.data;
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}`;

      const dbPosition = await getUniswapV3VaultPositionService().findByPositionHash(user.id, positionHash);

      if (!dbPosition) {
        const errorResponse = createErrorResponse(ApiErrorCode.POSITION_NOT_FOUND, 'Vault position not found',
          `No vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`);
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND] });
      }

      const position = await getUniswapV3VaultPositionService().switchQuoteToken(dbPosition.id);

      const serializedPosition = serializeUniswapV3VaultPosition(position) as UniswapV3VaultPositionResponse;
      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/switch-quote-token', error, { requestId });

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('does not exist')) {
          const errorResponse = createErrorResponse(ApiErrorCode.POSITION_NOT_FOUND, 'Position not found', error.message);
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND] });
        }
        if (error.message.includes('rate limit') || error.message.includes('too many requests')) {
          const errorResponse = createErrorResponse(ApiErrorCode.TOO_MANY_REQUESTS, 'Rate limit exceeded', error.message);
          apiLog.requestEnd(apiLogger, requestId, 429, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.TOO_MANY_REQUESTS] });
        }
      }

      const errorResponse = createErrorResponse(ApiErrorCode.INTERNAL_SERVER_ERROR, 'Failed to switch quote token',
        error instanceof Error ? error.message : String(error));
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR] });
    }
  });
}
