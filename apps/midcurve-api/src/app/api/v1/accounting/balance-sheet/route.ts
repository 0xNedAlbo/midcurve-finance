/**
 * Balance Sheet (NAV Report) Endpoint
 *
 * GET /api/v1/accounting/balance-sheet
 *
 * Returns the latest NAV snapshot as a balance sheet report.
 * Returns zeroes if no snapshot exists yet.
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
  type BalanceSheetResponse,
  type BalanceSheetPositionItem,
} from '@midcurve/api-shared';
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
      const snapshot = await getNavSnapshotService().getLatestSnapshot(user.id);

      const response: BalanceSheetResponse = snapshot
        ? {
            snapshotDate: snapshot.snapshotDate.toISOString(),
            reportingCurrency: snapshot.reportingCurrency,
            valuationMethod: snapshot.valuationMethod,
            totalAssets: snapshot.totalAssets,
            totalLiabilities: snapshot.totalLiabilities,
            netAssetValue: snapshot.netAssetValue,
            equity: {
              contributedCapital: snapshot.totalContributedCapital,
              capitalReturned: snapshot.totalCapitalReturned,
              accumulatedPnl: snapshot.totalAccumulatedPnl,
            },
            positions: (snapshot.positionBreakdown as unknown as BalanceSheetPositionItem[]) ?? [],
            activePositionCount: snapshot.activePositionCount,
          }
        : {
            snapshotDate: new Date().toISOString(),
            reportingCurrency: 'USD',
            valuationMethod: 'pool_price',
            totalAssets: '0',
            totalLiabilities: '0',
            netAssetValue: '0',
            equity: {
              contributedCapital: '0',
              capitalReturned: '0',
              accumulatedPnl: '0',
            },
            positions: [],
            activePositionCount: 0,
          };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), {
        status: 200,
        headers: { 'Cache-Control': 'private, no-cache' },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/accounting/balance-sheet', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve balance sheet',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
