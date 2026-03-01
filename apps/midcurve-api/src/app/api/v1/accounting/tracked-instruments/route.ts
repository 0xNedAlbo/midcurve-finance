/**
 * Tracked Positions Endpoint
 *
 * POST /api/v1/accounting/tracked-instruments
 *
 * Toggles accounting tracking for a position.
 * If tracked → untracks. If not tracked → tracks.
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
  ToggleTrackingRequestSchema,
  type ToggleTrackingResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { getJournalService, getJournalBackfillService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    // Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid JSON body'
      );
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
      });
    }

    const validation = ToggleTrackingRequestSchema.safeParse(body);
    if (!validation.success) {
      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid request body',
        validation.error.errors
      );
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
      });
    }

    const { positionHash } = validation.data;

    // Verify ownership and get pool hash for instrumentRef
    const position = await prisma.position.findFirst({
      where: { positionHash, userId: user.id },
      select: {
        id: true,
        pool: { select: { poolHash: true } },
      },
    });

    if (!position) {
      const errorResponse = createErrorResponse(
        ApiErrorCode.POSITION_NOT_FOUND,
        'Position not found'
      );
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
      });
    }

    const instrumentRef = position.pool.poolHash ?? '';

    // Toggle tracking
    const journalService = getJournalService();
    const currentlyTracked = await journalService.isTracked(user.id, positionHash);

    if (currentlyTracked) {
      await journalService.untrackPosition(user.id, positionHash);
      await journalService.deleteByPositionRef(positionHash);
    } else {
      await journalService.trackPosition(user.id, positionHash);

      // Backfill journal entries from position ledger history
      const backfillService = getJournalBackfillService();
      const backfillResult = await backfillService.backfillPosition(
        position.id,
        user.id,
        positionHash,
        instrumentRef,
      );

      apiLog.businessOperation(apiLogger, requestId, 'backfill', 'journal', positionHash, {
        entriesCreated: backfillResult.entriesCreated,
        eventsProcessed: backfillResult.eventsProcessed,
      });
    }

    const tracked = !currentlyTracked;

    apiLog.businessOperation(apiLogger, requestId, tracked ? 'track' : 'untrack', 'position', positionHash, {
      userId: user.id,
    });

    const response: ToggleTrackingResponse = { tracked };
    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(createSuccessResponse(response), { status: 200 });
  });
}
