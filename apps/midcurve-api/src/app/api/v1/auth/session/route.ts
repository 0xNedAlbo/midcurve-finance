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
 *     "user": { id, name, email, image, wallets }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSuccessResponse } from '@midcurve/api-shared';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user) => {
    return NextResponse.json(
      createSuccessResponse({
        user,
      }),
      { status: 200 }
    );
  });
}
