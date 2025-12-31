/**
 * Session Validation Endpoint
 *
 * GET /api/v1/auth/session
 *
 * Returns the current user if session is valid.
 * Used by the UI to check authentication status on page load.
 *
 * Requires valid session cookie.
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "user": { id, primaryWalletAddress, wallets, createdAt, updatedAt }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSuccessResponse } from '@midcurve/api-shared';
import type { SessionUser } from '@midcurve/api-shared';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user) => {
    // Find primary wallet address from wallets array
    const primaryWallet = user.wallets?.find((w) => w.isPrimary);
    const primaryWalletAddress = primaryWallet?.address || user.wallets?.[0]?.address || '';

    // Transform to SessionUser format expected by UI
    const sessionUser: SessionUser = {
      id: user.id,
      primaryWalletAddress,
      wallets: user.wallets || [],
      createdAt: new Date().toISOString(), // TODO: Get from user record
      updatedAt: new Date().toISOString(), // TODO: Get from user record
    };

    return NextResponse.json(
      createSuccessResponse({
        user: sessionUser,
      }),
      { status: 200 }
    );
  });
}
