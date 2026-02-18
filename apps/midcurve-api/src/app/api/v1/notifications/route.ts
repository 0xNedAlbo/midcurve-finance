/**
 * Notifications Endpoint
 *
 * GET /api/v1/notifications - List notifications with pagination
 * DELETE /api/v1/notifications - Bulk delete notifications
 *
 * Authentication: Required (session only)
 *
 * ARCHITECTURE NOTE: These routes access @midcurve/database (Prisma) directly
 * rather than going through a service class. Notifications are a UI-only concern
 * with no business logic beyond CRUD — a service wrapper adds no value here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma } from '@midcurve/database';
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

      const { limit = 10, cursor, eventType, isRead } = parseResult.data;

      // Build where clause
      const where: Prisma.UserNotificationWhereInput = { userId: user.id };
      if (eventType !== undefined) where.eventType = eventType;
      if (isRead !== undefined) where.isRead = isRead;

      // Cursor-based pagination
      if (cursor) {
        const cursorNotification = await prisma.userNotification.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        });
        if (cursorNotification) {
          where.createdAt = { lt: cursorNotification.createdAt };
        }
      }

      // Fetch limit + 1 to determine if there are more results
      const notifications = await prisma.userNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      const hasMore = notifications.length > limit;
      if (hasMore) notifications.pop();

      const lastNotification = notifications[notifications.length - 1];
      const nextCursor = hasMore && lastNotification ? lastNotification.id : null;

      // Map to API response format
      const mapped: NotificationData[] = notifications.map((n) => ({
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
        notifications: mapped,
        nextCursor,
        hasMore,
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

      // Delete only notifications belonging to the authenticated user
      const result = await prisma.userNotification.deleteMany({
        where: {
          id: { in: ids },
          userId: user.id,
        },
      });

      const responseData: BulkDeleteNotificationsResponseData = {
        deletedCount: result.count,
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
