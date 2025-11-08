/**
 * Uniswap V3 Pool Metrics Endpoint
 *
 * GET /api/v1/pools/uniswapv3/:chainId/:address/metrics - Get fresh pool metrics
 *
 * Authentication: Required (session or API key)
 *
 * This endpoint fetches fresh pool metrics from the subgraph for APR calculations.
 * It requires the pool to be discovered first (exists in database) and will return
 * 404 if the pool is not found.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3SubgraphClient } from '@midcurve/services';
import { normalizeAddress } from '@midcurve/shared';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  type PoolMetricsData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subgraphClient = UniswapV3SubgraphClient.getInstance();

// Validation schema for path parameters
const PoolMetricsParamsSchema = z.object({
  chainId: z
    .string()
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .transform((val) => parseInt(val, 10)),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

/**
 * GET /api/v1/pools/uniswapv3/:chainId/:address/metrics
 *
 * Fetches fresh pool metrics from the Uniswap V3 subgraph for APR calculations.
 *
 * Path params:
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 * - address (required): Pool contract address (0x...)
 *
 * Example:
 * GET /api/v1/pools/uniswapv3/42161/0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443/metrics
 *
 * Returns:
 * - Pool metrics with token-specific volume data for APR calculations
 * - 404 if pool not discovered yet (must call discover endpoint first)
 * - 503 if subgraph is unavailable
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
      const paramsResult = PoolMetricsParamsSchema.safeParse({
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

      // Normalize address for database lookup (EIP-55 checksum)
      const normalizedAddress = normalizeAddress(validatedAddress);

      // 2. Check if pool exists in database (must be discovered first)
      const pool = await prisma.pool.findFirst({
        where: {
          protocol: 'uniswapv3',
          AND: [
            {
              config: {
                path: ['address'],
                equals: normalizedAddress,
              },
            },
            {
              config: {
                path: ['chainId'],
                equals: validatedChainId,
              },
            },
          ],
        },
        select: { id: true },
      });

      if (!pool) {
        apiLogger.warn(
          { requestId, chainId: validatedChainId, poolAddress: validatedAddress },
          'Pool not found in database - must discover first'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Pool not found. Please discover the pool first using the discover endpoint.`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 3. Fetch fresh metrics from subgraph
      let feeData;
      try {
        feeData = await subgraphClient.getPoolFeeData(validatedChainId, normalizedAddress);
      } catch (error) {
        // Subgraph unavailable or pool not indexed
        apiLogger.error(
          { requestId, chainId: validatedChainId, poolAddress: validatedAddress, error },
          'Failed to fetch pool metrics from subgraph'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.SERVICE_UNAVAILABLE,
          'Failed to fetch pool metrics. The subgraph may be temporarily unavailable.',
          error instanceof Error ? error.message : undefined
        );

        apiLog.requestEnd(apiLogger, requestId, 503, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.SERVICE_UNAVAILABLE],
        });
      }

      // 4. Build response
      const metricsData: PoolMetricsData = {
        chainId: validatedChainId,
        poolAddress: normalizedAddress,
        tvlUSD: feeData.tvlUSD,
        volumeUSD: feeData.volumeUSD,
        feesUSD: feeData.feesUSD,
        volumeToken0: feeData.token0.dailyVolume,
        volumeToken1: feeData.token1.dailyVolume,
        token0Price: feeData.token0.price,
        token1Price: feeData.token1.price,
        calculatedAt: feeData.calculatedAt,
      };

      const response = createSuccessResponse(metricsData, {
        poolId: pool.id,
        chainId: validatedChainId,
        poolAddress: normalizedAddress,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/pools/uniswapv3/:chainId/:address/metrics',
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
