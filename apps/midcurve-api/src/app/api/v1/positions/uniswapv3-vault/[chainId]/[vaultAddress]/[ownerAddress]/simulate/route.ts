/**
 * Vault Position Simulation Endpoint
 *
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/simulate?price=<bigint>
 *
 * Same shape as the NFT counterpart. Vault values are scaled by the user's share
 * of total vault supply (sharesBalance / totalSupply), matching the domain class.
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
  PositionSimulateQuerySchema,
} from '@midcurve/api-shared';
import type { PositionSimulationResponse } from '@midcurve/api-shared';
import {
  calculatePositionValue,
  getTokenAmountsFromLiquidity_X96,
  priceToSqrtRatioX96,
  type Erc20Token,
} from '@midcurve/shared';
import { TickMath } from '@uniswap/v3-sdk';
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

      const { chainId, vaultAddress, ownerAddress } = pathValidation.data;
      const price = BigInt(queryValidation.data.price);
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

      // We compute everything from raw state here rather than calling
      // dbPosition.simulatePnLAtPrice — the domain method's bigint comparisons
      // can blow up when JSON-deserialized state fields arrive as strings.
      // BigInt() casts below are defensive against that hydration path.
      const baseIsToken0 = !dbPosition.isToken0Quote;
      const baseToken = (baseIsToken0 ? dbPosition.pool.token0 : dbPosition.pool.token1) as Erc20Token;
      const quoteToken = (baseIsToken0 ? dbPosition.pool.token1 : dbPosition.pool.token0) as Erc20Token;

      const sqrtPriceJSBI = priceToSqrtRatioX96(
        baseToken.address,
        quoteToken.address,
        baseToken.decimals,
        price,
      );
      const sqrtPriceX96 = BigInt(sqrtPriceJSBI.toString());
      const sqrtPriceLowerX96 = BigInt(
        TickMath.getSqrtRatioAtTick(dbPosition.tickLower).toString(),
      );
      const sqrtPriceUpperX96 = BigInt(
        TickMath.getSqrtRatioAtTick(dbPosition.tickUpper).toString(),
      );

      const fullValue = calculatePositionValue(
        BigInt(dbPosition.liquidity),
        sqrtPriceX96,
        dbPosition.tickLower,
        dbPosition.tickUpper,
        baseIsToken0,
      );

      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity_X96(
        BigInt(dbPosition.liquidity),
        sqrtPriceX96,
        sqrtPriceLowerX96,
        sqrtPriceUpperX96,
      );

      const totalSupply = BigInt(dbPosition.typedState.totalSupply);
      const sharesBalance = BigInt(dbPosition.typedState.sharesBalance);
      const costBasis = BigInt(dbPosition.costBasis);

      const positionValue =
        totalSupply > 0n ? (fullValue * sharesBalance) / totalSupply : 0n;
      const pnlValue = positionValue - costBasis;
      const pnlPercent =
        costBasis > 0n ? Number((pnlValue * 1000000n) / costBasis) / 10000 : 0;

      const fullBase = baseIsToken0 ? token0Amount : token1Amount;
      const fullQuote = baseIsToken0 ? token1Amount : token0Amount;
      const baseTokenAmount =
        totalSupply > 0n ? (fullBase * sharesBalance) / totalSupply : 0n;
      const quoteTokenAmount =
        totalSupply > 0n ? (fullQuote * sharesBalance) / totalSupply : 0n;

      let phase: 'below' | 'in-range' | 'above';
      if (sqrtPriceX96 < sqrtPriceLowerX96) phase = 'below';
      else if (sqrtPriceX96 >= sqrtPriceUpperX96) phase = 'above';
      else phase = 'in-range';

      const response: PositionSimulationResponse = {
        ...createSuccessResponse({
          price: price.toString(),
          positionValue: positionValue.toString(),
          pnlValue: pnlValue.toString(),
          pnlPercent,
          baseTokenAmount: baseTokenAmount.toString(),
          quoteTokenAmount: quoteTokenAmount.toString(),
          phase,
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
        'GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/simulate',
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
        'Failed to simulate vault position',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
