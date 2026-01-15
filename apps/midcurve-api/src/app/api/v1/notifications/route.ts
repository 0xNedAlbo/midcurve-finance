/**
 * Notifications Endpoint
 *
 * GET /api/v1/notifications - List notifications with pagination
 * DELETE /api/v1/notifications - Bulk delete notifications
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
  ListNotificationsQuerySchema,
  BulkDeleteNotificationsBodySchema,
  type ListNotificationsResponseData,
  type BulkDeleteNotificationsResponseData,
  type NotificationData,
  type NotificationPayload,
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
 * GET /api/v1/notifications
 *
 * List notifications for the authenticated user with cursor-based pagination.
 *
 * Query Parameters:
 * - limit: Number of notifications to return (1-100, default 10)
 * - cursor: Cursor for pagination (notification ID)
 * - eventType: Filter by event type
 * - isRead: Filter by read status ('true' or 'false')
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query parameters
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const parseResult = ListNotificationsQuerySchema.safeParse(searchParams);

      if (!parseResult.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          parseResult.error.message
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { limit, cursor, eventType, isRead } = parseResult.data;

      // Fetch notifications
      const result = await getNotificationService().listByUser(user.id, {
        limit,
        cursor,
        eventType,
        isRead,
      });

      // Map to API response format
      const notifications: NotificationData[] = result.notifications.map((n) => ({
        id: n.id,
        eventType: n.eventType as NotificationData['eventType'],
        positionId: n.positionId,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        readAt: n.readAt?.toISOString() ?? null,
        payload: n.payload as unknown as NotificationPayload,
        createdAt: n.createdAt.toISOString(),
      }));

      const responseData: ListNotificationsResponseData = {
        notifications,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
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
      apiLog.methodError(apiLogger, 'GET /api/v1/notifications', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve notifications',
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
 * DELETE /api/v1/notifications
 *
 * Bulk delete notifications for the authenticated user.
 *
 * Request Body:
 * - ids: Array of notification IDs to delete (1-100 items)
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse request body
      const body = await request.json();
      const parseResult = BulkDeleteNotificationsBodySchema.safeParse(body);

      if (!parseResult.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          parseResult.error.message
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { ids } = parseResult.data;

      // Verify notifications belong to user before deleting
      // For now, bulkDelete in service doesn't filter by user, so we need to verify ownership
      const notificationService = getNotificationService();

      // Verify each notification belongs to the user
      for (const id of ids) {
        const notification = await notificationService.findById(id);
        if (notification && notification.userId !== user.id) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.FORBIDDEN,
            'Cannot delete notifications belonging to another user'
          );
          apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
          });
        }
      }

      // Delete notifications
      const deletedCount = await notificationService.bulkDelete(ids);

      const responseData: BulkDeleteNotificationsResponseData = {
        deletedCount,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'DELETE /api/v1/notifications', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete notifications',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
