/**
 * Logout Endpoint
 *
 * POST /api/v1/auth/logout
 *
 * Invalidates the current session and clears the session cookie.
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "message": "Logged out successfully"
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createSuccessResponse } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getSessionService } from '@/lib/services';
import { getCorsHeaders, createPreflightResponse } from '@/lib/cors';
import { SESSION_COOKIE_NAME } from '@/middleware/with-session-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();
  const origin = request.headers.get('origin');

  apiLog.requestStart(apiLogger, requestId, request);

  try {
    // Get session cookie
    const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (sessionId) {
      // Invalidate session in database
      await getSessionService().invalidateSession(sessionId);
      apiLog.businessOperation(apiLogger, requestId, 'invalidated', 'session', sessionId.slice(0, 10));
    }

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    const response = NextResponse.json(
      createSuccessResponse({
        message: 'Logged out successfully',
      }),
      { status: 200 }
    );

    // Clear session cookie
    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: IS_PRODUCTION ? 'none' : 'lax',
      domain: COOKIE_DOMAIN,
      path: '/',
      maxAge: 0, // Expire immediately
    });

    // Add CORS headers
    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    apiLog.methodError(apiLogger, 'POST /api/v1/auth/logout', error, { requestId });

    // Even if there's an error, still clear the cookie
    const response = NextResponse.json(
      createSuccessResponse({
        message: 'Logged out',
      }),
      { status: 200 }
    );

    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: IS_PRODUCTION ? 'none' : 'lax',
      domain: COOKIE_DOMAIN,
      path: '/',
      maxAge: 0,
    });

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }
}
