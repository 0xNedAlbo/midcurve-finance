/**
 * Position PnL Curve Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/pnl-curve
 *   ?priceMin=<bigint>&priceMax=<bigint>&numPoints=<int>
 *
 * Returns a list of (price, positionValue, pnl, pnlPercent, phase) points
 * across the requested price range. priceMin/priceMax default to ±50%
 * around the current pool price; numPoints defaults to 100, capped at 200.
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
  PositionPnlCurveQuerySchema,
} from '@midcurve/api-shared';
import type { PositionPnlCurveResponse } from '@midcurve/api-shared';
import {
  generatePnLCurve,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
  type Erc20Token,
  type UniswapV3Pool,
} from '@midcurve/shared';
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

      const search = new URL(request.url).searchParams;
      const queryValidation = PositionPnlCurveQuerySchema.safeParse({
        priceMin: search.get('priceMin') ?? undefined,
        priceMax: search.get('priceMax') ?? undefined,
        numPoints: search.get('numPoints') ?? undefined,
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

      const baseIsToken0 = !dbPosition.isToken0Quote;
      const baseToken = (baseIsToken0 ? dbPosition.pool.token0 : dbPosition.pool.token1) as Erc20Token;
      const quoteToken = (baseIsToken0 ? dbPosition.pool.token1 : dbPosition.pool.token0) as Erc20Token;

      const pool = dbPosition.pool as UniswapV3Pool;
      const sqrtPriceX96 = pool.typedState.sqrtPriceX96;
      const currentPrice = baseIsToken0
        ? pricePerToken0InToken1(sqrtPriceX96, baseToken.decimals)
        : pricePerToken1InToken0(sqrtPriceX96, baseToken.decimals);

      // Defaults: ±50% around current price.
      const priceMin = queryValidation.data.priceMin
        ? BigInt(queryValidation.data.priceMin)
        : (currentPrice * 50n) / 100n;
      const priceMax = queryValidation.data.priceMax
        ? BigInt(queryValidation.data.priceMax)
        : (currentPrice * 150n) / 100n;
      const numPoints = queryValidation.data.numPoints ?? 100;

      if (priceMin >= priceMax) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'priceMin must be strictly less than priceMax',
          { priceMin: priceMin.toString(), priceMax: priceMax.toString() },
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const tickSpacing = pool.typedConfig.tickSpacing;

      const points = generatePnLCurve(
        dbPosition.liquidity,
        dbPosition.tickLower,
        dbPosition.tickUpper,
        dbPosition.costBasis,
        baseToken.address,
        quoteToken.address,
        baseToken.decimals,
        tickSpacing,
        { min: priceMin, max: priceMax },
        numPoints,
      );

      const response: PositionPnlCurveResponse = {
        ...createSuccessResponse({
          positionId: dbPosition.id,
          liquidity: dbPosition.liquidity.toString(),
          costBasis: dbPosition.costBasis.toString(),
          tickLower: dbPosition.tickLower,
          tickUpper: dbPosition.tickUpper,
          baseTokenSymbol: baseToken.symbol,
          quoteTokenSymbol: quoteToken.symbol,
          baseTokenDecimals: baseToken.decimals,
          quoteTokenDecimals: quoteToken.decimals,
          currentPrice: currentPrice.toString(),
          priceMin: priceMin.toString(),
          priceMax: priceMax.toString(),
          numPoints: points.length,
          curve: points.map((p) => ({
            price: p.price.toString(),
            positionValue: p.positionValue.toString(),
            pnl: p.pnl.toString(),
            pnlPercent: p.pnlPercent,
            phase: p.phase,
          })),
        }),
        meta: { timestamp: new Date().toISOString(), requestId },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/pnl-curve',
        error,
        { requestId },
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to generate position PnL curve',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
