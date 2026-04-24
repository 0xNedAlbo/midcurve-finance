/**
 * Position Conversion Summary Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/conversion
 *
 * Returns the "how much of each token did this position convert, at what
 * average price, and what premium did the fees add" summary that the UI
 * Conversion tab and the MCP server consume.
 *
 * The actual math lives in @midcurve/shared (computeUniswapV3ConversionSummary)
 * and is replayed from the ledger on each call, so the response reflects the
 * current pool price.
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  LedgerPathParamsSchema,
} from '@midcurve/api-shared';
import type { ConversionSummaryResponse, LedgerEventData } from '@midcurve/api-shared';
import {
  computeUniswapV3ConversionSummary,
  serializeConversionSummary,
  type ConversionLedgerEvent,
} from '@midcurve/shared';
import { serializeUniswapV3Position } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getUniswapV3PositionService,
  getUniswapV3PositionLedgerService,
} from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> },
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const validation = LedgerPathParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = validation.data;
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
      });

      const dbPosition = await getUniswapV3PositionService().findByPositionHash(
        user.id,
        positionHash,
      );

      if (!dbPosition) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No Uniswap V3 position found for chainId ${chainId} and nftId ${nftId}`,
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      const ledgerEvents = await getUniswapV3PositionLedgerService(dbPosition.id).findAll();

      const serializedPosition = serializeUniswapV3Position(dbPosition);
      const serializedEvents = ledgerEvents.map(
        (e: { toJSON: () => unknown }) => e.toJSON(),
      ) as unknown as LedgerEventData[];

      const summary = computeUniswapV3ConversionSummary(
        serializedPosition,
        serializedEvents as unknown as ConversionLedgerEvent[],
      );

      const response: ConversionSummaryResponse = {
        ...createSuccessResponse(serializeConversionSummary(summary)),
        meta: { timestamp: new Date().toISOString(), requestId },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/conversion',
        error,
        { requestId },
      );

      if (error instanceof Error) {
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found',
            error.message,
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }
      }

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to compute position conversion summary',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
