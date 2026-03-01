/**
 * Bulk Position Refresh Endpoint
 *
 * POST /api/v1/positions/refresh-all
 *
 * Refreshes all of the user's active tracked positions from on-chain data.
 * Rate-limited: returns 429 if oldest position was updated < 60s ago.
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
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { getUniswapV3PositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RATE_LIMIT_SECONDS = 60;

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Load user's active positions
      const positions = await prisma.position.findMany({
        where: {
          userId: user.id,
          isActive: true,
          positionHash: { not: null },
        },
        select: {
          id: true,
          updatedAt: true,
          config: true,
        },
      });

      if (positions.length === 0) {
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(
          createSuccessResponse({ refreshedCount: 0, oldestUpdatedAt: new Date().toISOString() }),
          { status: 200 }
        );
      }

      // Rate-limit check: MIN(updatedAt) across all positions
      const oldestUpdatedAt = positions.reduce(
        (oldest, p) => (p.updatedAt < oldest ? p.updatedAt : oldest),
        positions[0]!.updatedAt
      );

      const secondsSinceOldest = (Date.now() - oldestUpdatedAt.getTime()) / 1000;
      if (secondsSinceOldest < RATE_LIMIT_SECONDS) {
        const retryAfter = Math.ceil(RATE_LIMIT_SECONDS - secondsSinceOldest);
        apiLog.requestEnd(apiLogger, requestId, 429, Date.now() - startTime);
        return NextResponse.json(
          createSuccessResponse({
            skipped: true,
            retryAfter,
            oldestUpdatedAt: oldestUpdatedAt.toISOString(),
          }),
          { status: 429 }
        );
      }

      // Refresh each position using the existing service
      const positionService = getUniswapV3PositionService();
      let refreshedCount = 0;

      // Refresh each position sequentially
      for (const p of positions) {
        await positionService.refresh(p.id);
        refreshedCount++;
      }

      // Get updated oldest timestamp
      const updatedPositions = await prisma.position.findMany({
        where: { userId: user.id, isActive: true },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'asc' },
        take: 1,
      });

      const newOldestUpdatedAt = updatedPositions[0]?.updatedAt ?? new Date();

      apiLog.businessOperation(apiLogger, requestId, 'refresh-all', 'positions', user.id, {
        refreshedCount,
      });
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(
        createSuccessResponse({
          refreshedCount,
          oldestUpdatedAt: newOldestUpdatedAt.toISOString(),
        }),
        { status: 200 }
      );
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/positions/refresh-all', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to refresh positions',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
