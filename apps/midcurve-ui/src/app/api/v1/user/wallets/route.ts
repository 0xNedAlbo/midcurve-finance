/**
 * List Wallets Endpoint
 *
 * GET /api/v1/user/wallets
 *
 * Returns all wallet addresses linked to the authenticated user.
 * Wallets are ordered by isPrimary (primary first), then by creation date.
 *
 * Authentication: Required (session or API key)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "wallet_123",
 *       "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *       "chainId": 1,
 *       "isPrimary": true,
 *       "createdAt": "2024-01-01T00:00:00.000Z",
 *       "updatedAt": "2024-01-01T00:00:00.000Z"
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { AuthUserService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const userService = new AuthUserService();

export async function GET(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Fetch user's wallets (ordered by isPrimary desc, then createdAt asc)
      const wallets = await userService.getUserWallets(user.id);

      const response = createSuccessResponse(wallets);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-cache',
        },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/user/wallets', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve wallets',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
