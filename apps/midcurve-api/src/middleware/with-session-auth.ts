/**
 * Session Authentication Middleware
 *
 * Validates session cookie and injects authenticated user into handler.
 * This replaces the dual auth (session + API key) middleware from the old UI.
 *
 * Usage:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withSessionAuth(request, async (user, requestId) => {
 *     // user is authenticated here
 *     return NextResponse.json({ data: user });
 *   });
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getSessionService, getAuthUserService } from '@/lib/services';
import { getCorsHeaders } from '@/lib/cors';
import { apiLogger, apiLog } from '@/lib/logger';
import { createErrorResponse, ApiErrorCode, ErrorCodeToHttpStatus } from '@midcurve/api-shared';
import type { AuthenticatedUser } from '@midcurve/api-shared';

export const SESSION_COOKIE_NAME = 'midcurve_session';

/**
 * Middleware wrapper for authenticated routes
 *
 * @param request - Next.js request object
 * @param handler - Route handler function receiving authenticated user
 * @returns Response from handler or 401 error
 */
export async function withSessionAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser, requestId: string) => Promise<Response>
): Promise<Response> {
  const requestId = nanoid();
  const origin = request.headers.get('origin');

  // Get session cookie
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    apiLog.authFailure(apiLogger, requestId, 'No session cookie provided', 'session');

    const response = NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'No session cookie provided'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
    );

    // Add CORS headers
    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  // Validate session
  const sessionData = await getSessionService().validateSession(sessionId);

  if (!sessionData) {
    apiLog.authFailure(apiLogger, requestId, 'Invalid or expired session', 'session');

    const response = NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'Invalid or expired session'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
    );

    // Clear invalid cookie
    response.cookies.delete(SESSION_COOKIE_NAME);

    // Add CORS headers
    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  // Fetch user
  const user = await getAuthUserService().findUserById(sessionData.userId);
  if (!user) {
    apiLog.authFailure(apiLogger, requestId, 'User not found', 'session');

    const response = NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'User not found'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
    );

    // Clear invalid session cookie
    response.cookies.delete(SESSION_COOKIE_NAME);

    // Add CORS headers
    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  const authenticatedUser: AuthenticatedUser = {
    id: user.id,
    address: user.address,
    name: user.name,
  };

  apiLog.authSuccess(apiLogger, requestId, user.id, 'session');

  // Call handler with authenticated user
  const response = await handler(authenticatedUser, requestId);

  // Add CORS headers to response
  Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}
