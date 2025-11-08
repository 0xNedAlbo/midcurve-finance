/**
 * Authentication Middleware
 *
 * Provides unified authentication for API routes supporting:
 * 1. API key auth (Bearer mc_xxx)
 * 2. Session auth (Auth.js JWT - same origin cookies)
 *
 * Usage:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withAuth(request, async (user) => {
 *     // user is authenticated
 *     return NextResponse.json({ data: user })
 *   })
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';
import { AuthApiKeyService, AuthUserService } from '@midcurve/services';
import { createErrorResponse, ApiErrorCode, ErrorCodeToHttpStatus } from '@midcurve/api-shared';
import type { AuthenticatedUser } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

const apiKeyService = new AuthApiKeyService();
const userService = new AuthUserService();

/**
 * Middleware wrapper for authenticated routes
 *
 * @param request - Next.js request object
 * @param handler - Route handler function receiving authenticated user
 * @returns Response from handler or 401 error
 */
export async function withAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser, requestId: string) => Promise<Response>
): Promise<Response> {
  const requestId = nanoid();

  // 1. Check for API key in Authorization header
  const authHeader = request.headers.get('authorization');
  const apiKey = authHeader?.replace('Bearer ', '').trim();

  if (apiKey && apiKey.startsWith('mc_')) {
    const user = await validateApiKey(apiKey, requestId);
    if (user) {
      apiLog.authSuccess(apiLogger, requestId, user.id, 'api_key', apiKey.slice(0, 10));
      return handler(user, requestId);
    }
    apiLog.authFailure(apiLogger, requestId, 'Invalid API key', 'api_key');
  }

  // 2. Check for session (Auth.js JWT)
  const session = await auth();
  if (session?.user?.id) {
    const user: AuthenticatedUser = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      wallets: session.user.wallets,
    };
    apiLog.authSuccess(apiLogger, requestId, user.id, 'session');
    return handler(user, requestId);
  }

  // 3. Unauthorized
  apiLog.authFailure(apiLogger, requestId, 'No valid session or API key provided');

  const errorResponse = createErrorResponse(
    ApiErrorCode.UNAUTHORIZED,
    'Authentication required. Provide a valid session or API key.'
  );

  return NextResponse.json(errorResponse, {
    status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED],
  });
}

/**
 * Validate API key and return associated user
 *
 * @param key - API key from Authorization header
 * @param requestId - Request ID for logging
 * @returns Authenticated user or null if invalid
 */
async function validateApiKey(
  key: string,
  requestId: string
): Promise<AuthenticatedUser | null> {
  try {
    // Validate API key and get record
    const apiKeyRecord = await apiKeyService.validateApiKey(key);

    if (!apiKeyRecord) {
      apiLog.methodError(apiLogger, 'validateApiKey', new Error('API key not found'), {
        requestId,
        keyPrefix: key.slice(0, 10),
      });
      return null;
    }

    // Update last used timestamp (fire-and-forget)
    apiKeyService.updateLastUsed(apiKeyRecord.id).catch((err) => {
      apiLog.methodError(apiLogger, 'updateLastUsed', err, {
        requestId,
        apiKeyId: apiKeyRecord.id,
      });
    });

    // Fetch user
    const user = await userService.findUserById(apiKeyRecord.userId);

    if (!user) {
      apiLog.methodError(
        apiLogger,
        'validateApiKey',
        new Error('User not found for API key'),
        {
          requestId,
          userId: apiKeyRecord.userId,
        }
      );
      return null;
    }

    // Fetch user's wallets
    const wallets = await userService.getUserWallets(user.id);

    // Return user data
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      wallets: wallets || [],
    };
  } catch (error) {
    apiLog.methodError(apiLogger, 'validateApiKey', error, { requestId });
    return null;
  }
}
