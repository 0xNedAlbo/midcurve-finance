/**
 * Strategy Shutdown Lifecycle Endpoint
 *
 * POST /api/v1/strategies/lifecycle/shutdown
 *
 * Authentication: Required (session only)
 *
 * This endpoint proxies shutdown requests to the EVM service.
 * It validates the request and forwards to the EVM service's
 * /api/strategy/{contractAddress}/shutdown endpoint.
 *
 * Request body:
 * - contractAddress: The contract address of the strategy to shutdown
 *
 * Returns 202 Accepted with operation status and poll URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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
 * Request validation schema
 */
const ShutdownStrategyRequestSchema = z.object({
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
});

/**
 * OPTIONS /api/v1/strategies/lifecycle/shutdown
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/strategies/lifecycle/shutdown
 *
 * Shutdown a running strategy.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const validation = ShutdownStrategyRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { contractAddress } = validation.data;
      const normalizedAddress = contractAddress.toLowerCase();

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'shutdown',
        'strategy',
        user.id,
        { contractAddress: normalizedAddress }
      );

      // 2. Forward to EVM service
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      let evmResult: {
        contractAddress: string;
        operation: string;
        operationStatus: string;
      };

      try {
        const evmResponse = await fetch(
          `${evmServiceUrl}/api/strategy/${normalizedAddress}/shutdown`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (!evmResponse.ok) {
          const errorData = await evmResponse.json().catch(() => ({}));
          apiLogger.error(
            {
              requestId,
              contractAddress: normalizedAddress,
              evmStatus: evmResponse.status,
              evmError: errorData,
            },
            'EVM service shutdown request failed'
          );

          const errorResponse = createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            `Shutdown failed: ${errorData.error || 'EVM service error'}`,
            { contractAddress: normalizedAddress, evmError: errorData }
          );

          apiLog.requestEnd(apiLogger, requestId, evmResponse.status, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: evmResponse.status });
        }

        evmResult = await evmResponse.json();
      } catch (error: unknown) {
        apiLogger.error(
          {
            requestId,
            contractAddress: normalizedAddress,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to connect to EVM service'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          `Failed to connect to EVM service: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { contractAddress: normalizedAddress }
        );

        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // 3. Build status URL for Location header (dedicated operation polling endpoint)
      const statusUrl = `/api/v1/strategies/${normalizedAddress}/shutdown`;

      // 4. Return 202 Accepted with Location header and pollUrl in body
      apiLogger.info(
        {
          requestId,
          contractAddress: normalizedAddress,
          operationStatus: evmResult.operationStatus,
          userId: user.id,
        },
        'Strategy shutdown initiated'
      );

      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);

      return NextResponse.json(
        createSuccessResponse({
          contractAddress: normalizedAddress,
          operation: 'shutdown',
          operationStatus: evmResult.operationStatus,
          pollUrl: statusUrl,
        }),
        {
          status: 202,
          headers: {
            Location: statusUrl,
          },
        }
      );
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/strategies/lifecycle/shutdown',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to shutdown strategy',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
