/**
 * Strategy List Endpoint
 *
 * GET /api/v1/strategies/list
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createErrorResponse,
  createPaginatedResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  ListStrategiesQuerySchema,
} from '@midcurve/api-shared';
import type {
  ListStrategiesResponse,
  ListStrategyData,
  SerializedStrategyMetrics,
} from '@midcurve/api-shared';
import type { StrategyPositionJSON } from '@midcurve/shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getStrategyService, getStrategyMetricsService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/strategies/list
 *
 * List user's strategies with pagination, filtering, and sorting.
 * Includes computed metrics for each strategy.
 *
 * Query parameters:
 * - state (optional): Filter by state ('active', 'pending', 'shutdown', 'all') - default: 'all'
 * - strategyType (optional): Filter by strategy type
 * - sortBy (optional): Sort field ('createdAt', 'updatedAt', 'name') - default: 'createdAt'
 * - sortDirection (optional): Sort direction ('asc', 'desc') - default: 'desc'
 * - limit (optional): Results per page (1-100, default: 20)
 * - offset (optional): Pagination offset (>=0, default: 0)
 * - includePositions (optional): Include positions in response - default: false
 * - includeWallets (optional): Include wallets in response - default: false
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        state: searchParams.get('state') ?? undefined,
        strategyType: searchParams.get('strategyType') ?? undefined,
        sortBy: searchParams.get('sortBy') ?? undefined,
        sortDirection: searchParams.get('sortDirection') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        offset: searchParams.get('offset') ?? undefined,
        includePositions: searchParams.get('includePositions') ?? undefined,
        includeWallets: searchParams.get('includeWallets') ?? undefined,
      };

      const validation = ListStrategiesQuerySchema.safeParse(queryParams);

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

      const {
        state,
        strategyType,
        sortBy,
        sortDirection,
        limit,
        offset,
        includePositions,
        includeWallets,
      } = validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'strategies',
        user.id,
        {
          state,
          strategyType,
          sortBy,
          sortDirection,
          limit,
          offset,
          includePositions,
          includeWallets,
        }
      );

      // 2. Build filter options for StrategyService
      const strategyService = getStrategyService();
      const metricsService = getStrategyMetricsService();

      // Map state filter
      const statusFilter =
        state === 'all'
          ? undefined
          : (state as
              | 'pending'
              | 'deploying'
              | 'deployed'
              | 'starting'
              | 'active'
              | 'shutting_down'
              | 'shutdown');

      // 3. Query strategies
      const strategies = await strategyService.findByUserId(user.id, {
        status: statusFilter,
        strategyType,
        includeQuoteToken: true,
        includeWallets,
      });

      // 4. Apply sorting (service returns createdAt desc by default)
      const sortedStrategies = [...strategies];
      if (sortBy === 'name') {
        sortedStrategies.sort((a, b) => {
          const cmp = a.name.localeCompare(b.name);
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      } else if (sortBy === 'updatedAt') {
        sortedStrategies.sort((a, b) => {
          const cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      } else if (sortBy === 'createdAt') {
        // Default sort from service is desc, reverse if asc
        if (sortDirection === 'asc') {
          sortedStrategies.reverse();
        }
      }
      // TODO: Support sorting by currentValue and unrealizedPnl (requires fetching metrics first)

      // 5. Apply pagination
      const total = sortedStrategies.length;
      const paginatedStrategies = sortedStrategies.slice(
        offset,
        offset + limit
      );

      // 6. Compute metrics for each strategy
      const strategiesWithMetrics: ListStrategyData[] = await Promise.all(
        paginatedStrategies.map(async (strategy) => {
          let metrics: SerializedStrategyMetrics;
          let positionCount = 0;
          let strategyPositions: StrategyPositionJSON[] | undefined;

          try {
            // Compute metrics
            const rawMetrics = await metricsService.getMetrics(strategy.id);
            metrics = serializeBigInt(rawMetrics) as SerializedStrategyMetrics;

            // Get position count (and positions if requested)
            // For now, we need to query positions separately
            // TODO: Add position count to strategy service
            if (includePositions) {
              // Metrics service already fetched positions internally
              // We need to fetch them again or refactor metrics service
              // For now, skip including positions in the response
              strategyPositions = undefined;
            }
          } catch (error) {
            // If metrics computation fails (e.g., no positions), use empty metrics
            apiLogger.warn(
              { requestId, strategyId: strategy.id, error },
              'Failed to compute strategy metrics, using empty metrics'
            );
            metrics = {
              quoteToken: serializeBigInt(strategy.quoteToken) as any,
              currentCostBasis: '0',
              currentValue: '0',
              realizedCapitalGain: '0',
              unrealizedIncome: '0',
              realizedIncome: '0',
              expenses: '0',
            };
          }

          // Serialize the strategy
          const serializedStrategy = serializeBigInt(strategy) as Record<
            string,
            unknown
          >;

          const result: ListStrategyData = {
            ...(serializedStrategy as Omit<
              ListStrategyData,
              'metrics' | 'positionCount' | 'strategyPositions'
            >),
            metrics,
            positionCount,
          };

          if (strategyPositions) {
            result.strategyPositions = strategyPositions;
          }

          return result;
        })
      );

      // 7. Create paginated response
      const response: ListStrategiesResponse = {
        ...createPaginatedResponse(strategiesWithMetrics, total, limit, offset),
        meta: {
          timestamp: new Date().toISOString(),
          filters: {
            state: state as any,
            ...(strategyType && { strategyType }),
            sortBy: sortBy as any,
            sortDirection: sortDirection as any,
          },
        },
      };

      apiLogger.info(
        {
          requestId,
          count: strategiesWithMetrics.length,
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        'Strategies retrieved successfully'
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/list',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve strategies',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
