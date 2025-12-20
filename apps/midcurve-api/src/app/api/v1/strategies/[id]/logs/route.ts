/**
 * Strategy Logs Endpoint
 *
 * GET /api/v1/strategies/:id/logs
 *
 * Authentication: Required (session only)
 *
 * Retrieves log messages emitted by a strategy during execution.
 * Logs are emitted via the LoggingMixin and persisted by the LogEffectHandler.
 *
 * Query Parameters:
 * - level: Filter by log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * - from: Start of time range (ISO 8601)
 * - to: End of time range (ISO 8601)
 * - limit: Max results per page (1-1000, default 100)
 * - cursor: Pagination cursor (log ID)
 *
 * Response (200):
 * {
 *   success: true,
 *   data: {
 *     logs: [{
 *       id: string,
 *       timestamp: string,
 *       level: number,
 *       levelName: string,
 *       topic: string,
 *       topicName: string | null,
 *       data: string,
 *       dataDecoded: string | null,
 *       epoch: string,
 *       correlationId: string
 *     }],
 *     nextCursor: string | null,
 *     hasMore: boolean
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import {
  createErrorResponse,
  createSuccessResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * OPTIONS /api/v1/strategies/:id/logs
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/strategies/:id/logs
 *
 * Get strategy logs with optional filtering and pagination.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { id } = await params;
      const url = new URL(request.url);

      // Parse query parameters
      const levelParam = url.searchParams.get('level');
      const fromParam = url.searchParams.get('from');
      const toParam = url.searchParams.get('to');
      const limitParam = url.searchParams.get('limit');
      const cursorParam = url.searchParams.get('cursor');

      // Validate level parameter
      const level = levelParam !== null ? parseInt(levelParam, 10) : undefined;
      if (level !== undefined && (isNaN(level) || level < 0 || level > 3)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid level parameter (must be 0-3)'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Validate date parameters
      const from = fromParam ? new Date(fromParam) : undefined;
      const to = toParam ? new Date(toParam) : undefined;
      if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid date format (use ISO 8601)'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Parse and validate limit
      const limit = Math.min(
        Math.max(1, limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT),
        MAX_LIMIT
      );

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'strategy-logs',
        user.id,
        {
          strategyId: id,
          level,
          from: from?.toISOString(),
          to: to?.toISOString(),
          limit,
          cursor: cursorParam,
        }
      );

      // Verify strategy exists and belongs to user
      const strategy = await prisma.strategy.findUnique({
        where: { id },
        select: { id: true, userId: true },
      });

      if (!strategy) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.STRATEGY_NOT_FOUND,
          'Strategy not found'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.STRATEGY_NOT_FOUND],
        });
      }

      // Authorization: Only owner can view logs
      if (strategy.userId !== user.id) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'You do not have permission to view logs for this strategy'
        );
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
        });
      }

      // Build query conditions
      const where: {
        strategyId: string;
        level?: number;
        timestamp?: { gte?: Date; lte?: Date };
        id?: { lt: string };
      } = {
        strategyId: id,
      };

      if (level !== undefined) {
        where.level = level;
      }

      if (from || to) {
        where.timestamp = {};
        if (from) where.timestamp.gte = from;
        if (to) where.timestamp.lte = to;
      }

      if (cursorParam) {
        where.id = { lt: cursorParam };
      }

      // Fetch logs (ordered by timestamp DESC for recent-first)
      const logs = await prisma.strategyLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: limit + 1, // Fetch one extra to check if there are more
        select: {
          id: true,
          timestamp: true,
          level: true,
          topic: true,
          topicName: true,
          data: true,
          dataDecoded: true,
          epoch: true,
          correlationId: true,
        },
      });

      // Check if there are more results
      const hasMore = logs.length > limit;
      if (hasMore) {
        logs.pop(); // Remove the extra item
      }

      // Format response
      const formattedLogs = logs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        level: log.level,
        levelName: LOG_LEVEL_NAMES[log.level] || 'UNKNOWN',
        topic: log.topic,
        topicName: log.topicName,
        data: log.data,
        dataDecoded: log.dataDecoded,
        epoch: log.epoch.toString(),
        correlationId: log.correlationId,
      }));

      const nextCursor =
        hasMore && logs.length > 0 ? logs[logs.length - 1].id : null;

      apiLogger.info({
        requestId,
        strategyId: id,
        logsReturned: formattedLogs.length,
        hasMore,
        msg: 'Strategy logs retrieved',
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(
        createSuccessResponse({
          logs: formattedLogs,
          nextCursor,
          hasMore,
        })
      );
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/strategies/:id/logs', error, {
        requestId,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve strategy logs',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
