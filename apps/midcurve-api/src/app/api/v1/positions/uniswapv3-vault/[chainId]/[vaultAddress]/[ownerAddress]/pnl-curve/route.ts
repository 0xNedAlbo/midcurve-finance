/**
 * Vault Position PnL Curve Endpoint
 *
 * Same shape as the NFT counterpart, but scales the curve points by the
 * user's share of total vault supply (sharesBalance / totalSupply) so the
 * PnL reflects the user's proportional holding.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetUniswapV3VaultPositionParamsSchema,
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
import { getUniswapV3VaultPositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ chainId: string; vaultAddress: string; ownerAddress: string }>;
  },
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const pathValidation = GetUniswapV3VaultPositionParamsSchema.safeParse(resolvedParams);
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

      const { chainId, vaultAddress, ownerAddress } = pathValidation.data;
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;

      const dbPosition = await getUniswapV3VaultPositionService().findByPositionHash(
        user.id,
        positionHash,
      );
      if (!dbPosition) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Vault position not found',
          `No vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`,
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

      // Generate the full-vault curve, then proportionally scale value/pnl
      // and recompute pnlPercent against the user's costBasis. Defensive
      // BigInt() casts below — vault state fields can arrive as strings
      // depending on the hydration path.
      const fullPoints = generatePnLCurve(
        BigInt(dbPosition.liquidity),
        dbPosition.tickLower,
        dbPosition.tickUpper,
        // Use 0 as costBasis here — we'll recompute pnl against the user's
        // costBasis once we've scaled the value to the user's share.
        0n,
        baseToken.address,
        quoteToken.address,
        baseToken.decimals,
        tickSpacing,
        { min: priceMin, max: priceMax },
        numPoints,
      );

      const totalSupply = BigInt(dbPosition.typedState.totalSupply);
      const sharesBalance = BigInt(dbPosition.typedState.sharesBalance);
      const userCostBasis = BigInt(dbPosition.costBasis);

      const userPoints = fullPoints.map((p) => {
        const userValue =
          totalSupply > 0n ? (p.positionValue * sharesBalance) / totalSupply : 0n;
        const userPnl = userValue - userCostBasis;
        const userPnlPercent =
          userCostBasis > 0n ? Number((userPnl * 1000000n) / userCostBasis) / 10000 : 0;
        return {
          price: p.price.toString(),
          positionValue: userValue.toString(),
          pnl: userPnl.toString(),
          pnlPercent: userPnlPercent,
          phase: p.phase,
        };
      });

      const response: PositionPnlCurveResponse = {
        ...createSuccessResponse({
          positionId: dbPosition.id,
          liquidity: dbPosition.liquidity.toString(),
          costBasis: userCostBasis.toString(),
          tickLower: dbPosition.tickLower,
          tickUpper: dbPosition.tickUpper,
          baseTokenSymbol: baseToken.symbol,
          quoteTokenSymbol: quoteToken.symbol,
          baseTokenDecimals: baseToken.decimals,
          quoteTokenDecimals: quoteToken.decimals,
          currentPrice: currentPrice.toString(),
          priceMin: priceMin.toString(),
          priceMax: priceMax.toString(),
          numPoints: userPoints.length,
          curve: userPoints,
        }),
        meta: { timestamp: new Date().toISOString(), requestId },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/pnl-curve',
        error,
        { requestId },
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to generate vault PnL curve',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
