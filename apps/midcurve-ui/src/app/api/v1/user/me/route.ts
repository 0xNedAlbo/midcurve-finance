/**
 * Get Current User Endpoint
 *
 * GET /api/v1/user/me
 *
 * Returns the authenticated user's profile with wallet addresses.
 *
 * Authentication: Required (session or API key)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "user_123",
 *     "name": "User 0xA0b8...eB48",
 *     "email": null,
 *     "image": null,
 *     "wallets": [
 *       {
 *         "id": "wallet_123",
 *         "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *         "chainId": 1,
 *         "isPrimary": true,
 *         "createdAt": "2024-01-01T00:00:00Z"
 *       }
 *     ],
 *     "createdAt": "2024-01-01T00:00:00Z",
 *     "updatedAt": "2024-01-01T00:00:00Z"
 *   }
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
      // Fetch full user data
      const userData = await userService.findUserById(user.id);

      if (!userData) {
        apiLog.methodError(
          apiLogger,
          'GET /api/v1/user/me',
          new Error('User not found'),
          { requestId, userId: user.id }
        );

        const errorResponse = createErrorResponse(ApiErrorCode.NOT_FOUND, 'User not found');

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // Fetch user's wallets
      const wallets = await userService.getUserWallets(user.id);

      const response = createSuccessResponse({
        id: userData.id,
        name: userData.name,
        email: userData.email,
        image: userData.image,
        wallets: wallets || [],
        createdAt: userData.createdAt.toISOString(),
        updatedAt: userData.updatedAt.toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-cache',
        },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/user/me', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve user data',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
