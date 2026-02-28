/**
 * NAV Timeline Endpoint
 *
 * GET /api/v1/accounting/nav-timeline?days=90
 *
 * Returns daily NAV snapshot points for charting.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  type NavTimelineResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { getNavSnapshotService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    const daysParam = request.nextUrl.searchParams.get('days');
    const days = Math.min(Math.max(parseInt(daysParam ?? '90', 10) || 90, 1), 365);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const snapshots = await getNavSnapshotService().getSnapshotRange(
      user.id,
      startDate,
      endDate,
    );

    const response: NavTimelineResponse = snapshots.map((s) => ({
      date: s.snapshotDate.toISOString(),
      netAssetValue: s.netAssetValue,
    }));

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(createSuccessResponse(response), {
      status: 200,
      headers: { 'Cache-Control': 'private, no-cache' },
    });
  });
}
