/**
 * Refund Status Polling Endpoint
 *
 * GET /api/v1/automation/wallet/refund/[requestId] - Get refund operation status
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type GetRefundStatusResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { getRefundOperation } from '@/lib/refund-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/wallet/refund/[requestId]
 *
 * Poll for refund operation status.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      const { requestId: refundRequestId } = await context.params;

      // Look up the operation
      const operation = getRefundOperation(refundRequestId);

      if (!operation) {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.NOT_FOUND, 'Refund operation not found'),
          { status: 404 }
        );
      }

      // Return operation status
      const response: GetRefundStatusResponse = createSuccessResponse({
        requestId: operation.requestId,
        chainId: operation.chainId,
        amount: operation.amount,
        toAddress: operation.toAddress,
        operationStatus: operation.operationStatus,
        operationError: operation.operationError,
        txHash: operation.txHash,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response);
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/wallet/refund/[requestId]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        error instanceof Error ? error.message : 'Failed to get refund status'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
