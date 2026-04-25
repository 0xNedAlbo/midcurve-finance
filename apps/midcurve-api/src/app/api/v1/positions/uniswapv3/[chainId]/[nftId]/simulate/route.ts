/**
 * Position Simulation Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/simulate?price=<bigint>
 *
 * Returns a hypothetical snapshot of the position at the supplied price:
 * value in quote token, PnL vs cost basis, base/quote amounts that would
 * be held at that price, and the phase (below / in-range / above).
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
  PositionSimulateQuerySchema,
} from '@midcurve/api-shared';
import type { PositionSimulationResponse } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PositionService } from '@/lib/services';

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
      const pathValidation = LedgerPathParamsSchema.safeParse(resolvedParams);
      if (!pathValidation.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          pathValidation.error.errors,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const queryValidation = PositionSimulateQuerySchema.safeParse({
        price: new URL(request.url).searchParams.get('price') ?? undefined,
      });
      if (!queryValidation.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          queryValidation.error.errors,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = pathValidation.data;
      const price = BigInt(queryValidation.data.price);
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

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

      const sim = dbPosition.simulatePnLAtPrice(price);

      const baseToken = dbPosition.isToken0Quote
        ? dbPosition.pool.token1
        : dbPosition.pool.token0;
      const quoteToken = dbPosition.isToken0Quote
        ? dbPosition.pool.token0
        : dbPosition.pool.token1;

      const response: PositionSimulationResponse = {
        ...createSuccessResponse({
          price: price.toString(),
          positionValue: sim.positionValue.toString(),
          pnlValue: sim.pnlValue.toString(),
          pnlPercent: sim.pnlPercent,
          baseTokenAmount: sim.baseTokenAmount.toString(),
          quoteTokenAmount: sim.quoteTokenAmount.toString(),
          phase: sim.phase,
          baseTokenSymbol: baseToken.symbol,
          quoteTokenSymbol: quoteToken.symbol,
          baseTokenDecimals: baseToken.decimals,
          quoteTokenDecimals: quoteToken.decimals,
        }),
        meta: { timestamp: new Date().toISOString(), requestId },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/simulate',
        error,
        { requestId },
      );

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('does not exist')) {
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
        'Failed to simulate position',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
