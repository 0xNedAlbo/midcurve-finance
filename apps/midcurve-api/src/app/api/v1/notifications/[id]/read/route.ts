/**
 * Mark Notification Read Endpoint
 *
 * PATCH /api/v1/notifications/:id/read - Mark a notification as read
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
  type NotificationData,
  type NotificationPayload,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getNotificationService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * PATCH /api/v1/notifications/:id/read
 *
 * Mark a single notification as read.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;

  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const notificationService = getNotificationService();

      // First verify the notification exists and belongs to user
      const existingNotification = await notificationService.findById(id);

      if (!existingNotification) {
        const errorResponse = createErrorResponse(ApiErrorCode.NOT_FOUND, 'Notification not found');
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // Verify ownership
      if (existingNotification.userId !== user.id) {
        const errorResponse = createErrorResponse(ApiErrorCode.FORBIDDEN, 'Access denied');
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
        });
      }

      // Mark as read
      const notification = await notificationService.markAsRead(id);

      const responseData: NotificationData = {
        id: notification.id,
        eventType: notification.eventType as NotificationData['eventType'],
        positionId: notification.positionId,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        readAt: notification.readAt?.toISOString() ?? null,
        payload: notification.payload as unknown as NotificationPayload,
        createdAt: notification.createdAt.toISOString(),
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'PATCH /api/v1/notifications/:id/read', error, {
        requestId,
        userId: user.id,
        notificationId: id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to mark notification as read',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
