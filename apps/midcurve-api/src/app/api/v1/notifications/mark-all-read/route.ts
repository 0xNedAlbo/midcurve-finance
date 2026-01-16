/**
 * Mark All Notifications Read Endpoint
 *
 * POST /api/v1/notifications/mark-all-read - Mark all notifications as read
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
  type MarkAllReadResponseData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getNotificationService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/notifications/mark-all-read
 *
 * Marks all unread notifications as read for the authenticated user.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const count = await getNotificationService().markAllAsRead(user.id);

      const responseData: MarkAllReadResponseData = { count };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/notifications/mark-all-read', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to mark notifications as read',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
