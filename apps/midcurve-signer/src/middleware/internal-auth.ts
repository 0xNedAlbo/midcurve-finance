/**
 * Internal API Authentication Middleware
 *
 * Validates requests from the midcurve-ui service layer.
 * This API is NOT exposed to the public internet - it lives in a private subnet.
 *
 * Authentication is via shared secret (API key) in the Authorization header.
 *
 * SECURITY:
 * - Only accepts requests with valid SIGNER_INTERNAL_API_KEY
 * - Should be deployed in private subnet (no public access)
 * - All requests are logged for audit purposes
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { signerLogger, signerLog } from '../lib/logger.js';

/**
 * Environment variable for the internal API key
 */
const INTERNAL_API_KEY_ENV = 'SIGNER_INTERNAL_API_KEY';

/**
 * Request context passed to route handlers
 */
export interface AuthenticatedRequest {
  /** Unique request ID for tracing */
  requestId: string;
  /** Original Next.js request */
  request: NextRequest;
  /** Timestamp when request started */
  startTime: number;
}

/**
 * Validate the internal API key
 */
function validateApiKey(authHeader: string | null): { valid: boolean; reason?: string } {
  if (!authHeader) {
    return { valid: false, reason: 'Missing Authorization header' };
  }

  // Expect: "Bearer <api-key>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, reason: 'Invalid Authorization header format (expected: Bearer <key>)' };
  }

  const providedKey = parts[1];
  const expectedKey = process.env[INTERNAL_API_KEY_ENV];

  if (!expectedKey) {
    // Log error but don't expose to client
    signerLogger.error({
      msg: `${INTERNAL_API_KEY_ENV} environment variable is not set!`,
    });
    return { valid: false, reason: 'Server configuration error' };
  }

  // Constant-time comparison to prevent timing attacks
  if (providedKey?.length !== expectedKey.length) {
    return { valid: false, reason: 'Invalid API key' };
  }

  let result = 0;
  for (let i = 0; i < expectedKey.length; i++) {
    result |= providedKey!.charCodeAt(i) ^ expectedKey.charCodeAt(i);
  }

  if (result !== 0) {
    return { valid: false, reason: 'Invalid API key' };
  }

  return { valid: true };
}

/**
 * Create an error response
 */
function createErrorResponse(
  requestId: string,
  status: number,
  error: string,
  message: string
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error,
      message,
      requestId,
    },
    { status }
  );
}

/**
 * Internal authentication middleware wrapper
 *
 * Usage:
 * ```typescript
 * import { withInternalAuth, type AuthenticatedRequest } from '@/middleware/internal-auth';
 *
 * export const POST = withInternalAuth(async ({ requestId, request }) => {
 *   // Your handler code
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withInternalAuth(
  handler: (ctx: AuthenticatedRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const requestId = nanoid(12);
    const startTime = Date.now();
    const logger = signerLogger.child({ requestId });

    // Log request start
    signerLog.requestStart(logger, requestId, request);

    try {
      // Validate API key
      const authResult = validateApiKey(request.headers.get('authorization'));

      if (!authResult.valid) {
        signerLog.internalAuth(logger, requestId, false, authResult.reason);

        const response = createErrorResponse(
          requestId,
          401,
          'UNAUTHORIZED',
          authResult.reason ?? 'Authentication failed'
        );

        signerLog.requestEnd(logger, requestId, 401, Date.now() - startTime);
        return response;
      }

      signerLog.internalAuth(logger, requestId, true);

      // Call the handler
      const response = await handler({ requestId, request, startTime });

      // Log request completion
      const statusCode = response.status;
      signerLog.requestEnd(logger, requestId, statusCode, Date.now() - startTime);

      // Add request ID to response headers
      response.headers.set('X-Request-Id', requestId);

      return response;
    } catch (error) {
      // Log unexpected error
      logger.error({
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        msg: 'Unhandled error in request handler',
      });

      const response = createErrorResponse(
        requestId,
        500,
        'INTERNAL_ERROR',
        'An unexpected error occurred'
      );

      signerLog.requestEnd(logger, requestId, 500, Date.now() - startTime);

      return response;
    }
  };
}

/**
 * Type-safe JSON body parser
 *
 * Usage:
 * ```typescript
 * const body = await parseJsonBody<MyRequestType>(request);
 * if (!body.success) {
 *   return NextResponse.json({ error: body.error }, { status: 400 });
 * }
 * const data = body.data;
 * ```
 */
export async function parseJsonBody<T>(
  request: NextRequest
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const body = await request.json();
    return { success: true, data: body as T };
  } catch {
    return { success: false, error: 'Invalid JSON body' };
  }
}
