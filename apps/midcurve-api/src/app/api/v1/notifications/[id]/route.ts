/**
 * Single Notification Endpoint
 *
 * GET /api/v1/notifications/:id - Get a single notification
 * DELETE /api/v1/notifications/:id - Delete a notification
 *
 * Authentication: Required (session only)
 *
 * ARCHITECTURE NOTE: These routes access @midcurve/database (Prisma) directly
 * rather than going through a service class. Notifications are a UI-only concern
 * with no business logic beyond CRUD — a service wrapper adds no value here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@midcurve/database';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  type NotificationData,
  type NotificationPayload,
  type DeleteNotificationResponseData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
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
 * GET /api/v1/notifications/:id
 *
 * Get a single notification by ID.
 */
export async function GET(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;

  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const notification = await prisma.userNotification.findUnique({
        where: { id },
      });

      if (!notification) {
        const errorResponse = createErrorResponse(ApiErrorCode.NOT_FOUND, 'Notification not found');
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // Verify ownership
      if (notification.userId !== user.id) {
        const errorResponse = createErrorResponse(ApiErrorCode.FORBIDDEN, 'Access denied');
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
        });
      }

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

      return NextResponse.json(response, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-cache',
        },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/notifications/:id', error, {
        requestId,
        userId: user.id,
        notificationId: id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve notification',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * DELETE /api/v1/notifications/:id
 *
 * Delete a single notification by ID.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;

  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const notification = await prisma.userNotification.findUnique({
        where: { id },
      });

      if (!notification) {
        const errorResponse = createErrorResponse(ApiErrorCode.NOT_FOUND, 'Notification not found');
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // Verify ownership
      if (notification.userId !== user.id) {
        const errorResponse = createErrorResponse(ApiErrorCode.FORBIDDEN, 'Access denied');
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
        });
      }

      await prisma.userNotification.delete({ where: { id } });

      const responseData: DeleteNotificationResponseData = { deleted: true };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'DELETE /api/v1/notifications/:id', error, {
        requestId,
        userId: user.id,
        notificationId: id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete notification',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
