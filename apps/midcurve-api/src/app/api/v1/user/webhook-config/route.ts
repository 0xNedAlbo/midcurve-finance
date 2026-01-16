/**
 * Webhook Configuration Endpoint
 *
 * GET /api/v1/user/webhook-config - Get webhook configuration
 * PUT /api/v1/user/webhook-config - Update webhook configuration
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
  UpdateWebhookConfigBodySchema,
  type WebhookConfigData,
  type NotificationEventType,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getWebhookConfigService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/user/webhook-config
 *
 * Get the authenticated user's webhook configuration.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const config = await getWebhookConfigService().getByUserId(user.id);

      // Return default config if none exists
      const responseData: WebhookConfigData = config
        ? {
            webhookUrl: config.webhookUrl,
            isActive: config.isActive,
            enabledEvents: config.enabledEvents as NotificationEventType[],
            hasSecret: !!config.webhookSecret,
            lastDeliveryAt: config.lastDeliveryAt?.toISOString() ?? null,
            lastDeliveryStatus: config.lastDeliveryStatus as WebhookConfigData['lastDeliveryStatus'],
            lastDeliveryError: config.lastDeliveryError,
          }
        : {
            webhookUrl: null,
            isActive: false,
            enabledEvents: [],
            hasSecret: false,
            lastDeliveryAt: null,
            lastDeliveryStatus: null,
            lastDeliveryError: null,
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
      apiLog.methodError(apiLogger, 'GET /api/v1/user/webhook-config', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve webhook configuration',
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
 * PUT /api/v1/user/webhook-config
 *
 * Update the authenticated user's webhook configuration.
 */
export async function PUT(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const body = await request.json();
      const parseResult = UpdateWebhookConfigBodySchema.safeParse(body);

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

      const { webhookUrl, isActive, enabledEvents, webhookSecret } = parseResult.data;

      // Update the configuration
      const config = await getWebhookConfigService().upsert(user.id, {
        webhookUrl,
        isActive,
        enabledEvents,
        webhookSecret,
      });

      const responseData: WebhookConfigData = {
        webhookUrl: config.webhookUrl,
        isActive: config.isActive,
        enabledEvents: config.enabledEvents as NotificationEventType[],
        hasSecret: !!config.webhookSecret,
        lastDeliveryAt: config.lastDeliveryAt?.toISOString() ?? null,
        lastDeliveryStatus: config.lastDeliveryStatus as WebhookConfigData['lastDeliveryStatus'],
        lastDeliveryError: config.lastDeliveryError,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'PUT /api/v1/user/webhook-config', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to update webhook configuration',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
