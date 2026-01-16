/**
 * Test Webhook Endpoint
 *
 * POST /api/v1/user/webhook-config/test - Send a test webhook
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  type TestWebhookResponseData,
  type NotificationEventType,
  NOTIFICATION_EVENT_TYPES,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getWebhookDeliveryService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

/**
 * Request body schema for test webhook
 */
const TestWebhookBodySchema = z.object({
  eventType: z.enum(NOTIFICATION_EVENT_TYPES).optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/user/webhook-config/test
 *
 * Send a test webhook to verify the user's configuration.
 * Optionally accepts an eventType in the body to test specific event payloads.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse optional body
      let eventType: NotificationEventType | undefined;
      try {
        const body = await request.json();
        const parsed = TestWebhookBodySchema.parse(body);
        eventType = parsed.eventType;
      } catch {
        // Body is optional, ignore parse errors
      }

      const result = await getWebhookDeliveryService().sendTestWebhook(user.id, eventType);

      const responseData: TestWebhookResponseData = {
        success: result.success,
        statusCode: result.statusCode,
        error: result.error,
        durationMs: result.durationMs,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/user/webhook-config/test', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to send test webhook',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
