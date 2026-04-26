/**
 * Pool Address Lookup Endpoint (Multi-Chain)
 *
 * GET /api/v1/pools/uniswapv3/lookup?address=0x...
 *
 * Searches for a pool address across all supported chains using on-chain
 * discovery (checks local DB first, then reads from contract).
 * Enriches with subgraph metrics when available.
 * Includes isFavorite status for each pool.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  LookupPoolByAddressQuerySchema,
} from '@midcurve/api-shared';
import type { LookupPoolByAddressData, PoolSearchResultItem } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getSubgraphClient,
  getFavoritePoolService,
  getPoolSigmaFilterService,
  getUniswapV3PoolService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import {
  getEvmConfig,
  isUniswapV3SubgraphSupported,
  type PoolSigmaDescriptor,
} from '@midcurve/services';
import type { Erc20Token } from '@midcurve/shared';
import { buildPoolMetricsBlock, type PoolMetricsInput } from '@/lib/pool-metrics-block';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  return withAuth(request, async (user, requestId) => {
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

      const evmConfig = getEvmConfig();
      const lookupChains = evmConfig.getSupportedChainIds();

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'lookupByAddress',
        'uniswapv3-pool',
        address,
        { address, chainCount: lookupChains.length }
      );

      // Discover pool on all supported chains in parallel (checks DB first, then on-chain)
      const subgraphClient = getSubgraphClient();
      const poolService = getUniswapV3PoolService();

      // Per-chain: discover pool + (optional) subgraph metrics. σ-filter
      // enrichment is done in a single batch after all chains return so that
      // tokens shared across chains are deduplicated (PRD §6.3).
      interface ChainLookup {
        result: PoolSearchResultItem;
        subgraph: PoolMetricsInput;
      }

      const chainPromises = lookupChains.map(async (chainId): Promise<ChainLookup | null> => {
        try {
          // 1. Discover pool (checks local DB first, then on-chain contract)
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

          // 2. Default subgraph metrics — zeros for chains without subgraph
          let subgraph: PoolMetricsInput = {
            tvlUSD: '0',
            volume24hUSD: '0',
            fees24hUSD: '0',
            fees7dUSD: '0',
            volume7dAvgUSD: '0',
            fees7dAvgUSD: '0',
            apr7d: 0,
          };

          // 3. Enrich with subgraph metrics if available for this chain
          if (isUniswapV3SubgraphSupported(chainId)) {
            try {
              const metricsMap = await subgraphClient.getPoolsMetricsBatch(chainId, [address]);
              const poolMetrics = metricsMap.get(address.toLowerCase());
              if (poolMetrics) {
                subgraph = {
                  tvlUSD: poolMetrics.tvlUSD,
                  volume24hUSD: poolMetrics.volume24hUSD,
                  fees24hUSD: poolMetrics.fees24hUSD,
                  fees7dUSD: poolMetrics.fees7dUSD,
                  volume7dAvgUSD: poolMetrics.volume7dAvgUSD,
                  fees7dAvgUSD: poolMetrics.fees7dAvgUSD,
                  apr7d: poolMetrics.apr7d,
                };
              }
            } catch (error) {
              apiLogger.warn({ chainId, address, error }, 'Subgraph metrics enrichment failed, using zero metrics');
            }
          }

          // 4. Build base PoolSearchResultItem with placeholder metrics —
          // the metrics block is filled in below after σ-enrichment.
          const chainName = evmConfig.getChainConfig(chainId).name;
          const result: PoolSearchResultItem = {
            poolAddress: pool.address,
            chainId,
            chainName,
            feeTier: pool.feeBps,
            token0: {
              address: (pool.token0 as Erc20Token).address,
              symbol: pool.token0.symbol,
              decimals: pool.token0.decimals,
            },
            token1: {
              address: (pool.token1 as Erc20Token).address,
              symbol: pool.token1.symbol,
              decimals: pool.token1.decimals,
            },
            metrics: buildPoolMetricsBlock(subgraph, undefined),
            isFavorite: false, // Will be enriched below
          };

          return { result, subgraph };
        } catch (error) {
          apiLogger.warn({ chainId, address, error }, 'Failed to lookup pool on chain');
          return null;
        }
      });

      const lookups = (await Promise.all(chainPromises)).filter(
        (l): l is ChainLookup => l !== null
      );

      // σ-filter enrichment: build descriptors for all pools at once so the
      // unique-token dedup (PRD §6.3) works across chains.
      if (lookups.length > 0) {
        const descriptors: PoolSigmaDescriptor[] = lookups.map(({ result, subgraph }) => ({
          poolHash: `uniswapv3/${result.chainId}/${result.poolAddress}`,
          token0Hash: `erc20/${result.chainId}/${result.token0.address}`,
          token1Hash: `erc20/${result.chainId}/${result.token1.address}`,
          tvlUSD: subgraph.tvlUSD,
          fees24hUSD: subgraph.fees24hUSD,
          fees7dAvgUSD: subgraph.fees7dAvgUSD,
        }));

        try {
          const sigmaResults = await getPoolSigmaFilterService().enrichPools(descriptors);
          for (const lookup of lookups) {
            const sigma = sigmaResults.get(
              `uniswapv3/${lookup.result.chainId}/${lookup.result.poolAddress}`
            );
            lookup.result.metrics = buildPoolMetricsBlock(lookup.subgraph, sigma);
          }
        } catch (error) {
          apiLogger.warn(
            { address, error },
            'Sigma-filter enrichment failed, returning metrics without sigma data'
          );
          // metrics blocks already populated with INSUFFICIENT_DATA defaults
        }
      }

      const pools = lookups.map((l) => l.result);

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
      pools.sort((a, b) => parseFloat(b.metrics.tvlUSD) - parseFloat(a.metrics.tvlUSD));

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'lookupComplete',
        'uniswapv3-pool',
        address,
        { poolsFound: pools.length, chainsSearched: lookupChains.length }
      );

      // Build response
      const responseData: LookupPoolByAddressData = {
        pools,
      };

      const response = createSuccessResponse(responseData, {
        timestamp: new Date().toISOString(),
        chainsSearched: lookupChains.length,
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
