/**
 * Automation Logs API Endpoint
 *
 * GET /api/v1/automation/logs - List automation logs for a position
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ListAutomationLogsQuerySchema,
  getAutomationLogLevelName,
  type AutomationLogData,
  type ListAutomationLogsResponseData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getAutomationLogService,
  getUniswapV3PositionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/logs
 *
 * List automation logs for a position.
 * Requires authentication and position ownership.
 *
 * Query parameters:
 * - positionId (required): Position ID to fetch logs for
 * - level (optional): Filter by log level (0-3)
 * - limit (optional): Max results (default 50, max 100)
 * - cursor (optional): Pagination cursor
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      apiLog.requestStart(apiLogger, requestId, request);

      // Parse query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        positionId: searchParams.get('positionId') ?? undefined,
        level: searchParams.get('level') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        cursor: searchParams.get('cursor') ?? undefined,
      };

      // Validate query parameters
      const validation = ListAutomationLogsQuerySchema.safeParse(queryParams);
      if (!validation.success) {
        const errorMessage = validation.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(
          createErrorResponse(ApiErrorCode.VALIDATION_ERROR, errorMessage),
          { status: 400 }
        );
      }

      const { positionId, level, limit, cursor } = validation.data;

      // Verify position exists and belongs to user
      const positionService = getUniswapV3PositionService();
      const position = await positionService.findById(positionId);

      if (!position) {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.NOT_FOUND, 'Position not found'),
          { status: 404 }
        );
      }

      if (position.userId !== user.id) {
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(
            ApiErrorCode.FORBIDDEN,
            'You do not have access to this position'
          ),
          { status: 403 }
        );
      }

      // Fetch logs
      const automationLogService = getAutomationLogService();
      const result = await automationLogService.listByPosition(positionId, {
        level,
        limit,
        cursor,
      });

      // Serialize logs for response
      const serializedLogs: AutomationLogData[] = result.logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        positionId: log.positionId,
        closeOrderId: log.closeOrderId,
        level: log.level as 0 | 1 | 2 | 3,
        levelName: getAutomationLogLevelName(log.level),
        logType: log.logType as AutomationLogData['logType'],
        message: log.message,
        context: log.context as AutomationLogData['context'],
      }));

      const responseData: ListAutomationLogsResponseData = {
        logs: serializedLogs,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'automation-logs',
        user.id,
        {
          positionId,
          count: serializedLogs.length,
          hasMore: result.hasMore,
        }
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(responseData));
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/logs',
        error as Error,
        { requestId }
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to list automation logs'
        ),
        { status: 500 }
      );
    }
  });
}
