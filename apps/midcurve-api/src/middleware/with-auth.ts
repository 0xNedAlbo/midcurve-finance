/**
 * Authentication Middleware
 *
 * Validates the Bearer token from the Authorization header and injects the
 * authenticated user into the route handler. Accepts both session tokens
 * (issued via SIWE login) and long-lived API keys (managed by the user).
 *
 * Token-type detection: keys starting with the API-key prefix (`mck_`) are
 * validated as API keys; everything else is validated as a session ID.
 *
 * Usage:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withAuth(request, async (user, requestId) => {
 *     return NextResponse.json({ data: user });
 *   });
 * }
 *
 * // For routes that must reject API keys (e.g. API key management itself):
 * export async function POST(request: NextRequest) {
 *   return withAuth(request, async (user, requestId) => { ... }, { sessionsOnly: true });
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { initAppConfig } from '@midcurve/services';
import {
  getApiKeyService,
  getAuthUserService,
  getSessionService,
} from '@/lib/services';
import { getCorsHeaders } from '@/lib/cors';
import { apiLogger, apiLog } from '@/lib/logger';
import { createErrorResponse, ApiErrorCode, ErrorCodeToHttpStatus } from '@midcurve/api-shared';
import type { AuthenticatedUser } from '@midcurve/api-shared';

const API_KEY_PREFIX = 'mck_';

export interface WithAuthOptions {
  /**
   * If true, only session tokens are accepted; API keys are rejected with 401.
   * Use for endpoints that manage credentials themselves (e.g. API key CRUD)
   * to prevent token-escalation: a stolen key cannot be used to mint more keys
   * or revoke other keys.
   */
  sessionsOnly?: boolean;
}

type AuthType = 'session' | 'api-key';

interface AuthResult {
  userId: string;
  authType: AuthType;
}

async function resolveAuth(token: string, sessionsOnly: boolean): Promise<AuthResult | null> {
  if (token.startsWith(API_KEY_PREFIX)) {
    if (sessionsOnly) {
      return null;
    }
    const validation = await getApiKeyService().validateKey(token);
    if (!validation) {
      return null;
    }
    return { userId: validation.userId, authType: 'api-key' };
  }

  const session = await getSessionService().validateSession(token);
  if (!session) {
    return null;
  }
  return { userId: session.userId, authType: 'session' };
}

/**
 * Middleware wrapper for authenticated routes.
 */
export async function withAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser, requestId: string) => Promise<Response>,
  options: WithAuthOptions = {}
): Promise<Response> {
  await initAppConfig();

  const requestId = nanoid();
  const origin = request.headers.get('origin');
  const sessionsOnly = options.sessionsOnly ?? false;

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    apiLog.authFailure(apiLogger, requestId, 'No authorization token provided');

    const response = NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'No authorization token provided'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
    );

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  const auth = await resolveAuth(token, sessionsOnly);

  if (!auth) {
    const reason = sessionsOnly && token.startsWith(API_KEY_PREFIX)
      ? 'API keys are not accepted on this endpoint'
      : 'Invalid or expired credentials';
    apiLog.authFailure(apiLogger, requestId, reason);

    const response = NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, reason),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
    );

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  const user = await getAuthUserService().findUserById(auth.userId);
  if (!user) {
    apiLog.authFailure(apiLogger, requestId, 'User not found', auth.authType);

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

  apiLog.authSuccess(apiLogger, requestId, user.id, auth.authType);

  const response = await handler(authenticatedUser, requestId);

  Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}
