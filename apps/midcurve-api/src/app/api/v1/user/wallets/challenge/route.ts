/**
 * Wallet Ownership Challenge Endpoint
 *
 * POST /api/v1/user/wallets/challenge - Generate a challenge message for wallet ownership verification
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeAddress } from '@midcurve/shared';
import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  WalletChallengeRequestSchema,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUserWalletService, getAuthNonceService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/user/wallets/challenge
 *
 * Generate a nonce and human-readable message for the user to sign,
 * proving ownership of the wallet address.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    const body = await request.json();
    const parseResult = WalletChallengeRequestSchema.safeParse(body);

    if (!parseResult.success) {
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid request body', parseResult.error.errors),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] }
      );
    }

    const { walletType, address } = parseResult.data;
    const normalizedAddress = normalizeAddress(address);

    // Check if wallet is already registered to another user
    const existing = await getUserWalletService().findByTypeAndAddress(walletType, normalizedAddress);
    if (existing) {
      if (existing.userId === user.id) {
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.CONFLICT, 'This wallet is already in your wallet list'),
          { status: 409 }
        );
      }
      apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.CONFLICT, 'This wallet is already registered to another account'),
        { status: 409 }
      );
    }

    // Generate nonce
    const nonce = await getAuthNonceService().generateNonce();

    // Build human-readable challenge message
    const message = `Midcurve Finance: Verify wallet ownership\n\nAddress: ${normalizedAddress}\nNonce: ${nonce}`;

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(
      createSuccessResponse({ message, nonce }),
      { status: 200 }
    );
  });
}
