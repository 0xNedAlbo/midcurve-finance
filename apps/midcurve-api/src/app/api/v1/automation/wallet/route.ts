/**
 * Automation Wallet API Endpoint
 *
 * GET /api/v1/automation/wallet - Get user's automation wallet info
 *
 * Returns the user's autowallet address. Balances are fetched client-side
 * by the UI using wagmi/viem since:
 * - UI already has RPC access configured for transaction signing
 * - Avoids adding RPC dependencies to backend services
 * - More responsive (no round-trip through API)
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
 * Get user's automation wallet address.
 * Returns empty address if no wallet exists yet.
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

      // Call signer service to get wallet info (no RPC, just database lookup)
      const signerResponse = await fetch(
        `${SIGNER_URL}/api/wallets/automation?userId=${encodeURIComponent(user.id)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
          },
        }
      );

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to get autowallet from signer');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to get automation wallet info'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signerData = await signerResponse.json();

      // If wallet is null, user hasn't created one yet
      if (!signerData.wallet) {
        const response: GetAutowalletResponse = createSuccessResponse({
          address: '',
          balances: [], // UI fetches balances client-side
          recentActivity: [],
        });
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(response, { status: 200 });
      }

      // Build response with wallet address
      const response: GetAutowalletResponse = createSuccessResponse({
        address: signerData.wallet.walletAddress || '',
        balances: [], // UI fetches balances client-side
        recentActivity: [],
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
