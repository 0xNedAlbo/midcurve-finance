/**
 * Revoke API Key Endpoint
 *
 * DELETE /api/v1/user/api-keys/:id
 *
 * Revokes (deletes) the specified API key.
 * The key will no longer be valid for authentication.
 *
 * Authentication: Required (session only, not API key)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "message": "API key revoked successfully"
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';
import { AuthApiKeyService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const apiKeyService = new AuthApiKeyService();

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  // Session auth only (not API keys - can't revoke using an API key)
  const session = await auth();
  if (!session?.user?.id) {
    apiLog.authFailure(apiLogger, requestId, 'Session authentication required');

    const errorResponse = createErrorResponse(
      ApiErrorCode.UNAUTHORIZED,
      'Session authentication required'
    );

    apiLog.requestEnd(apiLogger, requestId, 401, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED],
    });
  }

  try {
    const { id: keyId } = await params;

    // Validate key ID
    if (!keyId || typeof keyId !== 'string') {
      apiLog.validationError(apiLogger, requestId, { keyId });

      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid API key ID'
      );

      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
      });
    }

    // Revoke API key (service validates ownership)
    try {
      await apiKeyService.revokeApiKey(session.user.id, keyId);

      apiLog.businessOperation(apiLogger, requestId, 'revoked', 'api-key', keyId, {
        userId: session.user.id,
      });

      const response = createSuccessResponse({
        message: 'API key revoked successfully',
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Check if key not found or doesn't belong to user
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('does not belong')) {
          apiLog.methodError(apiLogger, 'DELETE /api/v1/user/api-keys/[id]', error, {
            requestId,
            userId: session.user.id,
            keyId,
          });

          const errorResponse = createErrorResponse(
            ApiErrorCode.API_KEY_NOT_FOUND,
            'API key not found or does not belong to user',
            { keyId }
          );

          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.API_KEY_NOT_FOUND],
          });
        }
      }
      throw error; // Re-throw unexpected errors
    }
  } catch (error) {
    apiLog.methodError(apiLogger, 'DELETE /api/v1/user/api-keys/[id]', error, {
      requestId,
      userId: session.user.id,
    });

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to revoke API key',
      error instanceof Error ? error.message : String(error)
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
