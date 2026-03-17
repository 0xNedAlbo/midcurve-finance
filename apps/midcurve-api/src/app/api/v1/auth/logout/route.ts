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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();
  const origin = request.headers.get('origin');

  apiLog.requestStart(apiLogger, requestId, request);

  try {
    // Get session token from Authorization header
    const authHeader = request.headers.get('authorization');
    const sessionId = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (sessionId) {
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

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    apiLog.methodError(apiLogger, 'POST /api/v1/auth/logout', error, { requestId });

    const response = NextResponse.json(
      createSuccessResponse({
        message: 'Logged out',
      }),
      { status: 200 }
    );

    Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }
}
