/**
 * Automation Wallet Refund API Endpoint
 *
 * POST /api/v1/automation/wallet/refund - Request refund of gas from autowallet
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  RefundAutowalletRequestSchema,
  type RefundAutowalletResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Signer service URL
const SIGNER_URL = process.env.SIGNER_URL || 'http://localhost:3003';
const SIGNER_INTERNAL_API_KEY = process.env.SIGNER_INTERNAL_API_KEY || '';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/automation/wallet/refund
 *
 * Request refund of gas from autowallet back to user's wallet.
 * Returns 202 Accepted with a poll URL for operation status.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse JSON body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Validate request
      const validation = RefundAutowalletRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const { chainId, amount, toAddress } = validation.data;

      // Verify the toAddress belongs to this user (one of their linked wallets)
      const userWallets = (user.wallets || []).map((w) => w.address.toLowerCase());
      if (!userWallets.includes(toAddress.toLowerCase())) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'Destination address is not linked to your account'
        );
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 403 });
      }

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'refund',
        'autowallet',
        user.id,
        { chainId, amount, toAddress }
      );

      // Generate request ID for tracking
      const refundRequestId = nanoid();

      // Call signer service to initiate refund
      const signerResponse = await fetch(`${SIGNER_URL}/api/automation/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': SIGNER_INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          requestId: refundRequestId,
          userId: user.id,
          chainId,
          amount,
          toAddress,
        }),
      });

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to initiate refund');

        // Handle specific errors
        if (signerResponse.status === 404) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.NOT_FOUND,
            'Automation wallet not found'
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 404 });
        }

        if (signerResponse.status === 400) {
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }
          const errorResponse = createErrorResponse(
            ApiErrorCode.VALIDATION_ERROR,
            errorData.message || 'Invalid refund request'
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 400 });
        }

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to initiate refund'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signerData = await signerResponse.json();

      // Build poll URL
      const pollUrl = `/api/v1/automation/wallet/refund/${refundRequestId}`;

      // Return 202 Accepted with polling info
      const response: RefundAutowalletResponse = createSuccessResponse({
        requestId: refundRequestId,
        chainId,
        amount,
        toAddress,
        operationStatus: signerData.data?.operationStatus || 'pending',
        txHash: signerData.data?.txHash,
        pollUrl,
      });

      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, {
        status: 202,
        headers: { Location: pollUrl },
      });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/automation/wallet/refund',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to initiate refund'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
