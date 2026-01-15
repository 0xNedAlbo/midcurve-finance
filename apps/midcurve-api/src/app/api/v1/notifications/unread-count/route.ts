/**
 * Unread Notifications Count Endpoint
 *
 * GET /api/v1/notifications/unread-count - Get count of unread notifications
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
  type UnreadCountResponseData,
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
 * GET /api/v1/notifications/unread-count
 *
 * Returns the count of unread notifications for the authenticated user.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const count = await getNotificationService().getUnreadCount(user.id);

      const responseData: UnreadCountResponseData = { count };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-cache',
        },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/notifications/unread-count', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve unread count',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
