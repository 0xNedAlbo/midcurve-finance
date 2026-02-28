/**
 * Period Comparison Endpoint
 *
 * GET /api/v1/accounting/period-comparison?period=month
 *
 * Returns current vs previous NAV snapshot for the given period.
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
  PeriodQuerySchema,
  type PeriodComparisonResponse,
  type SnapshotSummary,
  type PeriodDelta,
} from '@midcurve/api-shared';
import { prisma } from '@midcurve/database';
import { apiLogger, apiLog } from '@/lib/logger';
import { getNavSnapshotService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Validate period query param
      const url = new URL(request.url);
      const periodParam = url.searchParams.get('period') ?? 'month';
      const periodResult = PeriodQuerySchema.safeParse(periodParam);

      if (!periodResult.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid period parameter',
          periodResult.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const period = periodResult.data;
      const navService = getNavSnapshotService();
      const { current, previous } = await navService.getComparisonSnapshots(user.id, period);

      // Get reporting currency from user
      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { reportingCurrency: true },
      });
      const reportingCurrency = userData?.reportingCurrency ?? 'USD';

      if (!current) {
        // No snapshots at all — return empty comparison
        const response: PeriodComparisonResponse = {
          period,
          reportingCurrency,
          current: {
            snapshotDate: new Date().toISOString(),
            netAssetValue: '0',
            totalAssets: '0',
            totalLiabilities: '0',
            activePositionCount: 0,
          },
          previous: null,
          delta: null,
        };

        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(createSuccessResponse(response), {
          status: 200,
          headers: { 'Cache-Control': 'private, no-cache' },
        });
      }

      const currentSummary: SnapshotSummary = {
        snapshotDate: current.snapshotDate.toISOString(),
        netAssetValue: current.netAssetValue,
        totalAssets: current.totalAssets,
        totalLiabilities: current.totalLiabilities,
        activePositionCount: current.activePositionCount,
      };

      let previousSummary: SnapshotSummary | null = null;
      let delta: PeriodDelta | null = null;

      if (previous) {
        previousSummary = {
          snapshotDate: previous.snapshotDate.toISOString(),
          netAssetValue: previous.netAssetValue,
          totalAssets: previous.totalAssets,
          totalLiabilities: previous.totalLiabilities,
          activePositionCount: previous.activePositionCount,
        };

        const currentNav = BigInt(current.netAssetValue);
        const previousNav = BigInt(previous.netAssetValue);
        const navDelta = currentNav - previousNav;

        // Percentage change (scaled by 10^4 for basis points)
        const pctChange = previousNav !== 0n
          ? ((navDelta * 10000n) / previousNav).toString()
          : '0';

        delta = {
          netAssetValue: navDelta.toString(),
          netAssetValuePct: pctChange,
          feeIncome: (BigInt(current.periodFeeIncome) - BigInt(previous.periodFeeIncome)).toString(),
          realizedPnl: (BigInt(current.periodRealizedPnl) - BigInt(previous.periodRealizedPnl)).toString(),
          unrealizedPnl: (BigInt(current.periodUnrealizedPnl) - BigInt(previous.periodUnrealizedPnl)).toString(),
        };
      }

      const response: PeriodComparisonResponse = {
        period,
        reportingCurrency,
        current: currentSummary,
        previous: previousSummary,
        delta,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), {
        status: 200,
        headers: { 'Cache-Control': 'private, no-cache' },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/accounting/period-comparison', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve period comparison',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
