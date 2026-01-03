/**
 * Automation Wallet API Endpoint
 *
 * GET /api/v1/automation/wallet - Get user's automation wallet info
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type GetAutowalletResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';

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
 * GET /api/v1/automation/wallet
 *
 * Get user's automation wallet info including address and balances per chain.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get',
        'autowallet',
        user.id,
        {}
      );

      // Call signer service to get wallet info
      const signerResponse = await fetch(`${SIGNER_URL}/api/automation/wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': SIGNER_INTERNAL_API_KEY,
        },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to get autowallet from signer');

        // If 404, wallet doesn't exist yet - return empty state
        if (signerResponse.status === 404) {
          const response: GetAutowalletResponse = createSuccessResponse({
            address: '',
            balances: [],
            recentActivity: [],
          });
          apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
          return NextResponse.json(response, { status: 200 });
        }

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to get automation wallet info'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signerData = await signerResponse.json();

      // Build response with wallet info
      const response: GetAutowalletResponse = createSuccessResponse({
        address: signerData.data.walletAddress || '',
        balances: signerData.data.balances || [],
        recentActivity: signerData.data.recentActivity || [],
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/wallet',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve automation wallet'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
