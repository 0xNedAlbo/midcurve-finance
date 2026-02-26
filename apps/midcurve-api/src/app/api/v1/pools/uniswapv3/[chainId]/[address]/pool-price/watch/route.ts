/**
 * Uniswap V3 Pool Price Watch Endpoint
 *
 * POST /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch - Create price subscription
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint creates database-backed subscriptions for watching
 * Uniswap V3 pool price changes. The midcurve-onchain-data worker
 * subscribes to Swap events via WebSocket and updates the state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  UniswapV3PoolPriceWatchPathParamsSchema,
  type UniswapV3PoolPriceWatchResponseData,
  type UniswapV3PoolPriceSubscriptionInfo,
} from '@midcurve/api-shared';
import {
  type UniswapV3PoolPriceSubscriptionConfig,
  emptyUniswapV3PoolPriceState,
} from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PoolService } from '@/lib/services';
import { prisma, Prisma } from '@midcurve/database';
import { getAddress } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch
 *
 * Create a subscription for watching pool price changes.
 *
 * Path params:
 * - chainId: EVM chain ID
 * - address: Pool contract address
 *
 * Returns:
 * - 202 Accepted: Subscription created, includes current price state
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ chainId: string; address: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path params
      const { chainId, address } = await context.params;
      const validation = UniswapV3PoolPriceWatchPathParamsSchema.safeParse({
        chainId,
        address,
      });

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

      const chainIdNum = parseInt(validation.data.chainId, 10);
      const normalizedPool = getAddress(validation.data.address);

      // 2. Fetch current price from chain
      let currentSqrtPriceX96: string;
      let currentTick: number;

      try {
        const priceData = await getUniswapV3PoolService().fetchPoolPrice(
          chainIdNum,
          normalizedPool
        );
        currentSqrtPriceX96 = priceData.sqrtPriceX96.toString();
        currentTick = priceData.currentTick;
      } catch (error) {
        // Handle specific error cases
        if (error instanceof Error) {
          if (error.message.includes('not configured') || error.message.includes('not supported')) {
            const errorResponse = createErrorResponse(ApiErrorCode.BAD_REQUEST, error.message);
            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
            });
          }

          if (error.message.includes('Failed to read') || error.message.includes('readContract')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.BAD_GATEWAY,
              'Failed to read pool price from blockchain',
              error.message
            );
            apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_GATEWAY],
            });
          }
        }

        // Log error and use defaults
        apiLog.methodError(
          apiLogger,
          'POST /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch - fetchPoolPrice',
          error,
          { poolAddress: normalizedPool, chainId: chainIdNum, requestId }
        );
        currentSqrtPriceX96 = '0';
        currentTick = 0;
      }

      // 3. Create new subscription (1 per polling process)
      const subscriptionId = `ui:pool-price:${nanoid()}`;
      const createdAt = new Date();

      const config: UniswapV3PoolPriceSubscriptionConfig = {
        chainId: chainIdNum,
        poolAddress: normalizedPool,
        startedAt: createdAt.toISOString(),
      };

      await prisma.onchainDataSubscribers.create({
        data: {
          subscriptionType: 'uniswapv3-pool-price',
          subscriptionId,
          status: 'active',
          expiresAfterMs: 60_000,
          lastPolledAt: createdAt,
          config: config as unknown as Prisma.InputJsonValue,
          state: {
            ...emptyUniswapV3PoolPriceState(),
            sqrtPriceX96: currentSqrtPriceX96,
            tick: currentTick,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const pollUrl = `/api/v1/pools/uniswapv3/${chainIdNum}/${normalizedPool}/pool-price/watch/${subscriptionId}`;

      const subscription: UniswapV3PoolPriceSubscriptionInfo = {
        subscriptionId,
        pollUrl,
        poolAddress: normalizedPool,
        chainId: chainIdNum,
        currentSqrtPriceX96,
        currentTick,
        status: 'active',
        createdAt: createdAt.toISOString(),
      };

      // 4. Return response
      const responseData: UniswapV3PoolPriceWatchResponseData = {
        subscription,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, { status: 202 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
