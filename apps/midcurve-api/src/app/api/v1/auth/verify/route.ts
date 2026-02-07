/**
 * SIWE Verification Endpoint
 *
 * POST /api/v1/auth/verify
 *
 * Verifies SIWE signature and creates a server-side session.
 * Returns session cookie (httpOnly, secure, sameSite=none for cross-origin).
 *
 * Request Body:
 * {
 *   "message": "{ ... SIWE message params as JSON ... }",
 *   "signature": "0x..."
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "user": { id, name, address },
 *     "expiresAt": "2024-02-19T..."
 *   }
 * }
 *
 * Sets cookie: midcurve_session=<sessionId> (httpOnly, secure, sameSite=none)
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { SiweMessage } from 'siwe';
import { normalizeAddress } from '@midcurve/shared';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  type SessionUser,
} from '@midcurve/api-shared';
import { getDomainEventPublisher } from '@midcurve/services';
import { apiLogger, apiLog } from '@/lib/logger';
import { getAuthNonceService, getAuthUserService, getSessionService } from '@/lib/services';
import { getCorsHeaders, createPreflightResponse } from '@/lib/cors';
import { SESSION_COOKIE_NAME } from '@/middleware/with-session-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined; // e.g., '.midcurve.finance'

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();
  const origin = request.headers.get('origin');

  apiLog.requestStart(apiLogger, requestId, request);

  try {
    const body = await request.json();
    const { message, signature } = body;

    if (!message || !signature) {
      apiLog.validationError(apiLogger, requestId, 'Missing message or signature');

      const response = NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Missing message or signature'),
        { status: 400 }
      );

      Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    }

    // 1. Parse and verify SIWE message
    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(JSON.parse(message));
    } catch {
      apiLog.validationError(apiLogger, requestId, 'Invalid SIWE message format');

      const response = NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid SIWE message format'),
        { status: 400 }
      );

      Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    }

    // 2. Verify signature
    const result = await siweMessage.verify({ signature });

    if (!result.success) {
      apiLog.authFailure(apiLogger, requestId, 'Invalid signature', 'session');

      const response = NextResponse.json(
        createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'Invalid signature'),
        { status: 401 }
      );

      Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    }

    // 3. Validate nonce
    const nonceValid = await getAuthNonceService().validateNonce(siweMessage.nonce);
    if (!nonceValid) {
      apiLog.authFailure(apiLogger, requestId, 'Invalid or expired nonce', 'session');

      const response = NextResponse.json(
        createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'Invalid or expired nonce'),
        { status: 401 }
      );

      Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    }

    // 4. Consume nonce (single use)
    await getAuthNonceService().consumeNonce(siweMessage.nonce);

    // 5. Normalize address and find/create user
    const address = normalizeAddress(siweMessage.address);
    const chainId = siweMessage.chainId;

    let user = await getAuthUserService().findUserByWallet(address, chainId);

    if (!user) {
      // Create new user with wallet
      user = await getAuthUserService().createUser({
        name: `User ${address.slice(0, 6)}...${address.slice(-4)}`,
        walletAddress: address,
        walletChainId: chainId,
      });

      apiLog.businessOperation(apiLogger, requestId, 'created', 'user', user.id, { address });

      // Emit user.registered domain event via outbox
      try {
        const eventPublisher = getDomainEventPublisher();
        await eventPublisher.createAndPublish({
          type: 'user.registered',
          entityId: user.id,
          entityType: 'user',
          userId: user.id,
          payload: {
            userId: user.id,
            walletAddress: address,
            walletChainId: chainId,
            registeredAt: new Date().toISOString(),
          },
          source: 'api',
          traceId: requestId,
        });
      } catch (eventError) {
        apiLog.methodError(apiLogger, 'POST /api/v1/auth/verify', eventError, {
          requestId,
          context: 'Failed to emit user.registered event',
        });
      }
    }

    // 6. Create session
    const { sessionId, expiresAt } = await getSessionService().createSession(user.id, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
    });

    apiLog.authSuccess(apiLogger, requestId, user.id, 'session');
    apiLog.businessOperation(apiLogger, requestId, 'created', 'session', sessionId.slice(0, 10));

    // 7. Fetch user wallets for response
    const wallets = await getAuthUserService().getUserWallets(user.id);
    const primaryWallet = wallets.find((w) => w.isPrimary);
    const primaryWalletAddress = primaryWallet?.address || wallets[0]?.address || address;

    // Transform to SessionUser format expected by UI
    const sessionUser: SessionUser = {
      id: user.id,
      primaryWalletAddress,
      wallets: wallets.map((w) => ({
        id: w.id,
        userId: w.userId,
        address: w.address,
        chainId: w.chainId,
        isPrimary: w.isPrimary,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };

    // 8. Create response with session cookie
    const responseData = createSuccessResponse({
      user: sessionUser,
      expiresAt: expiresAt.toISOString(),
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    const response = NextResponse.json(responseData, { status: 200 });

    // Set httpOnly cookie for cross-origin
    response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: IS_PRODUCTION ? 'none' : 'lax', // 'none' required for cross-origin
      domain: COOKIE_DOMAIN,
      path: '/',
      expires: expiresAt,
    });

    // Add CORS headers
    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    apiLog.methodError(apiLogger, 'POST /api/v1/auth/verify', error, { requestId });

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Authentication failed',
      error instanceof Error ? error.message : String(error)
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    const response = NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }
}
