/**
 * User API Key Item Endpoint
 *
 * DELETE /api/v1/user/api-keys/[keyId] - Revoke an API key
 *
 * Authentication: Session-only — API keys cannot revoke other keys.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  type RevokeApiKeyData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getApiKeyService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * DELETE /api/v1/user/api-keys/[keyId]
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ keyId: string }> }
): Promise<Response> {
  return withAuth(
    request,
    async (user, requestId) => {
      const startTime = Date.now();
      const { keyId } = await context.params;

      const revoked = await getApiKeyService().revokeKey(user.id, keyId);

      if (!revoked) {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.API_KEY_NOT_FOUND, 'API key not found'),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.API_KEY_NOT_FOUND] }
        );
      }

      apiLog.businessOperation(apiLogger, requestId, 'revoked', 'apiKey', keyId);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      const data: RevokeApiKeyData = { revoked: true };
      return NextResponse.json(createSuccessResponse(data), { status: 200 });
    },
    { sessionsOnly: true }
  );
}
