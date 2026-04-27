/**
 * Uniswap V3 Pool Metrics Endpoint
 *
 * GET /api/v1/pools/uniswapv3/:chainId/:address/metrics - Get fresh pool metrics
 *
 * Authentication: Required (session only)
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
import { createPreflightResponse } from '@/lib/cors';
import { getPoolSigmaFilterService } from '@/lib/services';
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

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/pools/uniswapv3/:chainId/:address/metrics
 *
 * Fetches fresh pool metrics from the Uniswap V3 subgraph for APR calculations.
 *
 * Path params:
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 * - address (required): Pool contract address (0x...)
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

      // 2. Check if any position references this pool (pool must have been discovered via a position)
      const positionWithPool = await prisma.position.findFirst({
        where: {
          protocol: 'uniswapv3',
          config: {
            path: ['chainId'],
            equals: validatedChainId,
          },
          AND: [
            { config: { path: ['poolAddress'], string_contains: normalizedAddress } },
          ],
        },
        select: { id: true },
      });

      if (!positionWithPool) {
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

      // 3b. σ-filter enrichment (PRD §3.2-§3.4)
      const poolHash = `uniswapv3/${validatedChainId}/${normalizedAddress}`;
      let sigmaResult;
      try {
        const sigmaResults = await getPoolSigmaFilterService().enrichPools([
          {
            poolHash,
            token0Hash: `erc20/${validatedChainId}/${feeData.token0.address}`,
            token1Hash: `erc20/${validatedChainId}/${feeData.token1.address}`,
            tvlUSD: feeData.tvlUSD,
            // PoolFeeData uses legacy field names (volumeUSD/feesUSD); these
            // are the same 24h values used by other endpoints.
            fees24hUSD: feeData.feesUSD,
            fees7dAvgUSD: feeData.fees7dAvgUSD,
          },
        ]);
        sigmaResult = sigmaResults.get(poolHash);
      } catch (error) {
        apiLogger.warn(
          { requestId, poolHash, error },
          'Sigma-filter enrichment failed, returning metrics without sigma data'
        );
      }

      // 4. Build response
      const metricsData: PoolMetricsData = {
        chainId: validatedChainId,
        poolAddress: normalizedAddress,
        tvlUSD: feeData.tvlUSD,
        volumeUSD: feeData.volumeUSD,
        feesUSD: feeData.feesUSD,
        volume7dAvgUSD: feeData.volume7dAvgUSD,
        fees7dAvgUSD: feeData.fees7dAvgUSD,
        volumeToken0: feeData.token0.dailyVolume,
        volumeToken1: feeData.token1.dailyVolume,
        token0Price: feeData.token0.price,
        token1Price: feeData.token1.price,
        calculatedAt: feeData.calculatedAt,
        feeApr24h: sigmaResult?.feeApr24h ?? null,
        feeApr7dAvg: sigmaResult?.feeApr7dAvg ?? null,
        feeAprPrimary: sigmaResult?.feeAprPrimary ?? null,
        feeAprSource: sigmaResult?.feeAprSource ?? 'unavailable',
        volatility: sigmaResult?.volatility ?? {
          token0: { ref: '', sigma60d: { status: 'insufficient_history' }, sigma365d: { status: 'insufficient_history' } },
          token1: { ref: '', sigma60d: { status: 'insufficient_history' }, sigma365d: { status: 'insufficient_history' } },
          pair: { sigma60d: { status: 'insufficient_history' }, sigma365d: { status: 'insufficient_history' } },
          velocity: null,
          pivotCurrency: 'usd',
          computedAt: new Date(0).toISOString(),
        },
        sigmaFilter: sigmaResult?.sigmaFilter ?? {
          feeApr: null,
          sigmaSqOver8_365d: null,
          sigmaSqOver8_60d: null,
          marginLongTerm: null,
          marginShortTerm: null,
          verdictLongTerm: 'INSUFFICIENT_DATA',
          verdictShortTerm: 'INSUFFICIENT_DATA',
          verdictAgreement: 'INSUFFICIENT_DATA',
          coverageLongTerm: null,
          coverageBand: 'insufficient_data',
        },
      };

      const response = createSuccessResponse(metricsData, {
        chainId: validatedChainId,
        poolAddress: normalizedAddress,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(apiLogger, 'GET /api/v1/pools/uniswapv3/:chainId/:address/metrics', error, {
        requestId,
      });

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
