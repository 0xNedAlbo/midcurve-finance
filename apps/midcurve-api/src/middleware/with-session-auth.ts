/**
 * Session Authentication Middleware
 *
 * Validates session token from Authorization header and injects authenticated user into handler.
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
import { initAppConfig } from '@midcurve/services';
import { getSessionService, getAuthUserService } from '@/lib/services';
import { getCorsHeaders } from '@/lib/cors';
import { apiLogger, apiLog } from '@/lib/logger';
import { createErrorResponse, ApiErrorCode, ErrorCodeToHttpStatus } from '@midcurve/api-shared';
import type { AuthenticatedUser } from '@midcurve/api-shared';

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
  // Ensure AppConfig + EvmConfig are initialized in this webpack bundle.
  // Idempotent — returns immediately if already initialized.
  await initAppConfig();

  const requestId = nanoid();
  const origin = request.headers.get('origin');

  // Get session token from Authorization header
  const authHeader = request.headers.get('authorization');
  const sessionId = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!sessionId) {
    apiLog.authFailure(apiLogger, requestId, 'No authorization token provided', 'session');

    const response = NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'No authorization token provided'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
    );

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

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  const authenticatedUser: AuthenticatedUser = {
    id: user.id,
    address: user.address,
    name: user.name,
    isAdmin: user.isAdmin,
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
