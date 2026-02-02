/**
 * Pool Address Lookup Endpoint (Multi-Chain)
 *
 * GET /api/v1/pools/uniswapv3/lookup?address=0x...
 *
 * Searches for a pool address across all supported Uniswap V3 chains using on-chain discovery.
 * Returns pools found with optional metrics from subgraph (graceful degradation to zero values).
 * Includes isFavorite status for each pool.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  LookupPoolByAddressQuerySchema,
} from '@midcurve/api-shared';
import type { LookupPoolByAddressData, PoolSearchResultItem } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getSubgraphClient, getFavoritePoolService, getUniswapV3PoolService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Supported chains for Uniswap V3 lookup (BSC excluded - no Uniswap V3)
const LOOKUP_CHAINS = [1, 42161, 8453, 137, 10] as const;

// Chain ID to name mapping
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  42161: 'Arbitrum',
  8453: 'Base',
  137: 'Polygon',
  10: 'Optimism',
};

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/pools/uniswapv3/lookup?address=0x...
 *
 * Looks up a pool address across all supported chains.
 * Returns pools found with metrics and favorite status.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const validation = LookupPoolByAddressQuerySchema.safeParse(searchParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { address } = validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'lookupByAddress',
        'uniswapv3-pool',
        address,
        { address, chainCount: LOOKUP_CHAINS.length }
      );

      // Query all chains in parallel using on-chain discovery + optional subgraph metrics
      const subgraphClient = getSubgraphClient();
      const poolService = getUniswapV3PoolService();

      const chainPromises = LOOKUP_CHAINS.map(async (chainId) => {
        try {
          // 1. Try to discover pool on-chain (RPC)
          let pool;
          try {
            pool = await poolService.discover({
              poolAddress: address,
              chainId,
            });
          } catch {
            // Pool doesn't exist on this chain
            return null;
          }

          // 2. Pool exists - try to fetch metrics from subgraph (optional)
          let tvlUSD = '0';
          let volume24hUSD = '0';
          let fees24hUSD = '0';
          let fees7dUSD = '0';
          let apr7d = '0';

          try {
            const metricsMap = await subgraphClient.getPoolsMetricsBatch(chainId, [address]);
            const poolMetrics = metricsMap.get(address.toLowerCase());
            if (poolMetrics) {
              tvlUSD = poolMetrics.tvlUSD;
              volume24hUSD = poolMetrics.volume24hUSD;
              fees24hUSD = poolMetrics.fees24hUSD;
              fees7dUSD = poolMetrics.fees7dUSD;
              apr7d = poolMetrics.apr7d;
            }
          } catch (error) {
            apiLogger.warn({ chainId, address, error }, 'Failed to fetch metrics, using zero values');
          }

          // 3. Build result from discovered pool + metrics
          return {
            poolAddress: pool.config.address,
            chainId,
            chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
            feeTier: pool.feeBps,
            token0: {
              address: pool.token0.config.address,
              symbol: pool.token0.symbol,
              decimals: pool.token0.decimals,
            },
            token1: {
              address: pool.token1.config.address,
              symbol: pool.token1.symbol,
              decimals: pool.token1.decimals,
            },
            tvlUSD,
            volume24hUSD,
            fees24hUSD,
            fees7dUSD,
            apr7d,
            isFavorite: false, // Will be enriched below
          } as PoolSearchResultItem;
        } catch (error) {
          apiLogger.warn({ chainId, address, error }, 'Failed to lookup pool on chain');
          return null;
        }
      });

      const results = await Promise.all(chainPromises);
      const pools = results.filter((p): p is PoolSearchResultItem => p !== null);

      // Enrich with favorite status
      if (pools.length > 0) {
        const favoriteService = getFavoritePoolService();
        const favoriteKeys = await favoriteService.areFavorites(
          user.id,
          pools.map((p) => ({ chainId: p.chainId, poolAddress: p.poolAddress }))
        );

        for (const pool of pools) {
          pool.isFavorite = favoriteKeys.has(`${pool.chainId}:${pool.poolAddress}`);
        }
      }

      // Sort by TVL descending
      pools.sort((a, b) => parseFloat(b.tvlUSD) - parseFloat(a.tvlUSD));

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'lookupComplete',
        'uniswapv3-pool',
        address,
        { poolsFound: pools.length, chainsSearched: LOOKUP_CHAINS.length }
      );

      // Build response
      const responseData: LookupPoolByAddressData = {
        pools,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
        chainsSearched: LOOKUP_CHAINS.length,
        chainsWithResults: pools.length,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/pools/uniswapv3/lookup', error, {
        requestId,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to lookup pool',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
