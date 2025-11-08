/**
 * Uniswap V3 Pool Price Endpoint
 *
 * GET /api/v1/pools/uniswapv3/:chainId/:address/pool-price - Get current pool price
 *
 * Lightweight endpoint optimized for frequent price checks.
 * Returns only sqrtPriceX96 and currentTick without updating database.
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3PoolService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import type { GetPoolPriceResponse } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const poolService = new UniswapV3PoolService();

/**
 * Path params schema
 */
const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/, 'chainId must be a number').transform(Number),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format'),
});

/**
 * GET /api/v1/pools/uniswapv3/:chainId/:address/pool-price
 *
 * Retrieves current pool price data (sqrtPriceX96 and currentTick) from blockchain.
 * This is a lightweight operation that doesn't update the database.
 *
 * Path params:
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 * - address (required): Pool contract address (0x...)
 *
 * Example:
 * GET /api/v1/pools/uniswapv3/42161/0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443/pool-price
 *
 * Returns:
 * - sqrtPriceX96: Current pool price as X96 fixed-point bigint (string)
 * - currentTick: Current tick (number)
 * - timestamp: When the price was fetched (ISO 8601 string)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; address: string }> }
): Promise<Response> {
  return withAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Await and parse path params (Next.js 15 requires Promise)
      const { chainId, address } = await params;
      const paramsResult = PathParamsSchema.safeParse({ chainId, address });

      if (!paramsResult.success) {
        apiLog.validationError(apiLogger, requestId, paramsResult.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsResult.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId: validatedChainId, address: validatedAddress } = paramsResult.data;

      // 2. Fetch current pool price from blockchain
      let priceData;
      try {
        priceData = await poolService.getPoolPrice(validatedChainId, validatedAddress);
      } catch (error) {
        // Handle specific error cases
        if (error instanceof Error) {
          // Pool address invalid
          if (error.message.includes('Invalid pool address')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.VALIDATION_ERROR,
              `Invalid pool address format: ${validatedAddress}`
            );

            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
            });
          }

          // Chain not supported
          if (error.message.includes('not configured') || error.message.includes('not supported')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.BAD_REQUEST,
              error.message
            );

            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
            });
          }

          // RPC or on-chain read failure
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

        // Unknown error
        throw error;
      }

      // 3. Build response
      const responseData: GetPoolPriceResponse = {
        sqrtPriceX96: priceData.sqrtPriceX96,
        currentTick: priceData.currentTick,
        timestamp: new Date().toISOString(),
      };

      const response = createSuccessResponse(responseData, {
        address: validatedAddress,
        chainId: validatedChainId,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/pools/uniswapv3/:chainId/:address/pool-price',
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
