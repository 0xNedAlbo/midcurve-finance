/**
 * Uniswap V3 Pool Lookup Endpoint
 *
 * GET /api/v1/pools/uniswapv3/:chainId/:address - Get pool by address with fresh state
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3PoolService, UniswapV3SubgraphClient } from '@midcurve/services';
import type { UniswapV3Pool } from '@midcurve/shared';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import {
  GetUniswapV3PoolParamsSchema,
  GetUniswapV3PoolQuerySchema,
  type GetUniswapV3PoolData,
} from '@midcurve/api-shared';
import { serializeUniswapV3Pool } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const poolService = new UniswapV3PoolService();
const subgraphClient = UniswapV3SubgraphClient.getInstance();

/**
 * GET /api/v1/pools/uniswapv3/:chainId/:address
 *
 * Retrieves a Uniswap V3 pool by its contract address with fresh on-chain state.
 * Always returns current price, liquidity, and tick data.
 *
 * Path params:
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 * - address (required): Pool contract address (0x...)
 *
 * Query params:
 * - metrics (optional): Include subgraph metrics (TVL, volume, fees). Defaults to false.
 * - fees (optional): Include fee data for APR calculations (24h volumes, token prices). Defaults to false.
 *
 * Example:
 * GET /api/v1/pools/uniswapv3/42161/0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443?metrics=true&fees=true
 *
 * Returns:
 * - Pool data with fresh on-chain state (price, liquidity, tick)
 * - Optional subgraph metrics if metrics=true
 * - Optional fee data if fees=true
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
      const paramsResult = GetUniswapV3PoolParamsSchema.safeParse({
        chainId,
        address,
      });

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

      // 2. Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const queryResult = GetUniswapV3PoolQuerySchema.safeParse(searchParams);

      if (!queryResult.success) {
        apiLog.validationError(apiLogger, requestId, queryResult.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          queryResult.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { metrics, fees } = queryResult.data;

      // Log request (no dedicated request log method, done inline)

      // 3. Discover pool (creates if new, refreshes if existing)
      // This ensures we always return fresh on-chain state
      let pool;
      try {
        pool = await poolService.discover({
          poolAddress: validatedAddress,
          chainId: validatedChainId,
        });
      } catch (error) {
        // Handle specific error cases
        if (error instanceof Error) {
          // Pool not found or not a valid Uniswap V3 pool
          if (
            error.message.includes('Invalid pool address') ||
            error.message.includes('does not implement')
          ) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.NOT_FOUND,
              `Pool not found at address ${validatedAddress} on chain ${validatedChainId}`
            );

            apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
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
          if (error.message.includes('Failed to read')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.BAD_GATEWAY,
              'Failed to read pool data from blockchain',
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

      // 4. Optionally enrich with subgraph metrics
      let metricsData;
      if (metrics) {
        try {
          const poolMetrics = await subgraphClient.getPoolMetrics(validatedChainId, validatedAddress);
          metricsData = {
            tvlUSD: poolMetrics.tvlUSD,
            volumeUSD: poolMetrics.volumeUSD,
            feesUSD: poolMetrics.feesUSD,
          };
        } catch (error) {
          // Graceful degradation: log warning but don't fail request
          apiLogger.warn(
            { requestId, chainId: validatedChainId, address: validatedAddress, error },
            'Failed to fetch subgraph metrics, proceeding without metrics'
          );
          // metricsData remains undefined
        }
      }

      // 4b. Optionally enrich with fee data for APR calculations
      let feeData;
      if (fees) {
        try {
          const poolFeeData = await subgraphClient.getPoolFeeData(validatedChainId, validatedAddress);
          feeData = {
            token0DailyVolume: poolFeeData.token0.dailyVolume,
            token1DailyVolume: poolFeeData.token1.dailyVolume,
            token0Price: poolFeeData.token0.price,
            token1Price: poolFeeData.token1.price,
            poolLiquidity: poolFeeData.poolLiquidity,
            calculatedAt: poolFeeData.calculatedAt.toISOString(),
          };
        } catch (error) {
          // Graceful degradation: log warning but don't fail request
          apiLogger.warn(
            { requestId, chainId: validatedChainId, address: validatedAddress, error },
            'Failed to fetch fee data, proceeding without fees'
          );
          // feeData remains undefined
        }
      }

      // 5. Serialize pool (convert BigInt to strings)
      const serializedPool = serializeUniswapV3Pool(pool);

      // 6. Build response
      // Note: serializedPool has bigints/dates as strings for JSON compatibility
      // The type cast is safe because the serialized structure matches UniswapV3Pool
      const responseData: GetUniswapV3PoolData = {
        pool: serializedPool as unknown as UniswapV3Pool,
        ...(metricsData && { metrics: metricsData }),
        ...(feeData && { feeData }),
      };

      const response = createSuccessResponse(responseData, {
        poolId: pool.id,
        address: pool.config.address,
        chainId: validatedChainId,
        hasMetrics: !!metricsData,
        hasFeeData: !!feeData,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/pools/uniswapv3/:chainId/:address',
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
