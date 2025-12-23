/**
 * Strategy Shutdown Operation Polling Endpoint
 *
 * GET /api/v1/strategies/:id/shutdown
 *
 * Authentication: Required (session only)
 *
 * Proxies to the EVM service to poll shutdown operation status.
 * Used for polling after initiating a shutdown lifecycle operation.
 *
 * Returns 200 OK with operation status in body:
 * {
 *   contractAddress: string,
 *   operation: 'shutdown',
 *   operationStatus: 'pending' | 'stopping_loop' | 'completed' | 'failed',
 *   operationStartedAt?: string,
 *   operationCompletedAt?: string,
 *   operationError?: string
 * }
 *
 * Returns 404 if no shutdown operation found.
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
 * OPTIONS /api/v1/strategies/:id/shutdown
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/strategies/:id/shutdown
 *
 * Poll the shutdown operation status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      const { id } = await params;
      const contractAddress = id.toLowerCase();

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid contract address'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Forward to EVM service
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      try {
        const evmResponse = await fetch(
          `${evmServiceUrl}/api/strategy/${contractAddress}/shutdown`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        const evmResult = await evmResponse.json();

        // Log the result
        apiLogger.debug(
          {
            requestId,
            contractAddress,
            evmStatus: evmResponse.status,
            operationStatus: evmResult.operationStatus,
          },
          'Shutdown operation status polled'
        );

        apiLog.requestEnd(apiLogger, requestId, evmResponse.status, Date.now() - startTime);

        // Pass through the EVM response
        if (evmResponse.ok) {
          return NextResponse.json(createSuccessResponse(evmResult), {
            status: evmResponse.status,
          });
        }

        // Error response - pass through as-is
        return NextResponse.json(evmResult, { status: evmResponse.status });
      } catch (error: unknown) {
        apiLogger.error(
          {
            requestId,
            contractAddress,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to connect to EVM service'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          `Failed to connect to EVM service: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { contractAddress }
        );

        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/:id/shutdown',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to poll shutdown operation status',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
