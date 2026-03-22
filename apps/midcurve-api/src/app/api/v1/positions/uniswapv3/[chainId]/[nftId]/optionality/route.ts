/**
 * Position Optionality Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/optionality
 *
 * Returns the optionality view data for a Uniswap V3 position:
 * - Detail table rows (deposits, withdrawals, AMM rebalancing segments)
 * - Summary (net deposits, AMM buy/sell with VWAP, premium earned)
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
  LedgerPathParamsSchema,
} from '@midcurve/api-shared';
import type { OptionalityResponse } from '@midcurve/api-shared';
import {
  computeOptionalitySummary,
} from '@midcurve/services';
import type { UniswapV3Position } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getUniswapV3PositionService,
  getUniswapV3PositionLedgerService,
} from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createPreflightResponse(origin);
}

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/optionality
 */
export async function GET(
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

      // 2. Look up position
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

      // 3. Fetch ledger events
      const ledgerEvents = await getUniswapV3PositionLedgerService(dbPosition.id).findAll();

      apiLog.businessOperation(apiLogger, requestId, 'compute-optionality', 'position', dbPosition.id, {
        eventCount: ledgerEvents.length,
      });

      // 4. Extract position metadata
      const position = dbPosition as UniswapV3Position;
      const posConfig = position.typedConfig;
      const isToken0Quote = position.isToken0Quote;
      const baseIsToken0 = !isToken0Quote;

      const baseToken = baseIsToken0 ? position.pool.token0 : position.pool.token1;
      const quoteToken = baseIsToken0 ? position.pool.token1 : position.pool.token0;

      // Current pool sqrtPriceX96, position liquidity, and unclaimed fees from live state
      const poolState = position.pool.state as Record<string, unknown>;
      const currentSqrtPriceX96 = BigInt(poolState.sqrtPriceX96 as string);
      const currentLiquidity = position.liquidity;
      const posState = position.typedState;
      const unclaimedFees0 = posState.unclaimedFees0;
      const unclaimedFees1 = posState.unclaimedFees1;

      // 5. Compute optionality summary
      const result = computeOptionalitySummary({
        events: ledgerEvents,
        tickLower: posConfig.tickLower,
        tickUpper: posConfig.tickUpper,
        baseIsToken0,
        baseTokenSymbol: baseToken.symbol,
        quoteTokenSymbol: quoteToken.symbol,
        baseTokenDecimals: baseToken.decimals,
        quoteTokenDecimals: quoteToken.decimals,
        currentSqrtPriceX96,
        currentLiquidity,
        unclaimedFees0,
        unclaimedFees1,
      });

      // 6. Return response
      const response: OptionalityResponse = {
        ...createSuccessResponse(result),
        meta: {
          timestamp: new Date().toISOString(),
          requestId,
        },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/optionality',
        error,
        { requestId }
      );

      if (error instanceof Error) {
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
      }

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to compute position optionality data',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
