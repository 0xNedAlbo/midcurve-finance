/**
 * Strategy Deployment Status Endpoint
 *
 * GET /api/v1/strategies/deploy/status?strategyId=xxx
 *
 * Authentication: Required (session only)
 *
 * This endpoint proxies deployment status requests to the EVM service.
 * The UI should poll this endpoint to check deployment progress.
 *
 * Response codes:
 * - 202: Deployment in progress
 * - 200: Deployment completed successfully
 * - 404: No deployment found for this strategy
 * - 500: Deployment failed
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createErrorResponse,
  createSuccessResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * EVM service response type
 */
interface EvmDeploymentStatus {
  strategyId: string;
  status: 'pending' | 'signing' | 'broadcasting' | 'confirming' | 'setting_up_topology' | 'completed' | 'failed';
  contractAddress?: string;
  txHash?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/**
 * OPTIONS /api/v1/strategies/deploy/status
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/strategies/deploy/status?strategyId=xxx
 *
 * Poll deployment status from the EVM service.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Get strategyId from query params
      const { searchParams } = new URL(request.url);
      const strategyId = searchParams.get('strategyId');

      if (!strategyId) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'strategyId query parameter is required'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'poll-deployment-status',
        'strategy',
        strategyId,
        { userId: user.id }
      );

      // 2. Call EVM service to get deployment status
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      let evmResponse: Response;
      try {
        evmResponse = await fetch(
          `${evmServiceUrl}/api/strategy?strategyId=${strategyId}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error: unknown) {
        apiLogger.error(
          {
            requestId,
            strategyId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to connect to EVM service'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to connect to EVM service'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // 3. Handle EVM service responses
      if (evmResponse.status === 404) {
        // No deployment found
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'No deployment found for this strategy'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      const evmData = (await evmResponse.json()) as EvmDeploymentStatus;

      // 4. Return appropriate response based on status
      if (evmData.status === 'failed') {
        apiLogger.warn(
          {
            requestId,
            strategyId,
            error: evmData.error,
          },
          'Deployment failed'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          evmData.error || 'Deployment failed'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const isCompleted = evmData.status === 'completed';
      const statusCode = isCompleted ? 200 : 202;

      apiLogger.info(
        {
          requestId,
          strategyId,
          status: evmData.status,
          isCompleted,
        },
        'Deployment status retrieved'
      );

      const response = createSuccessResponse({
        strategyId: evmData.strategyId,
        status: evmData.status,
        contractAddress: evmData.contractAddress || null,
        txHash: evmData.txHash || null,
        startedAt: evmData.startedAt,
        completedAt: evmData.completedAt || null,
      });

      apiLog.requestEnd(apiLogger, requestId, statusCode, Date.now() - startTime);
      return NextResponse.json(response, { status: statusCode });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/deploy/status',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get deployment status',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
