/**
 * Set Primary Wallet Endpoint
 *
 * PATCH /api/v1/user/wallets/:id/primary
 *
 * Sets the specified wallet as the user's primary wallet.
 * All other wallets for the user will be set to isPrimary = false.
 *
 * Authentication: Required (session or API key)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "wallet_123",
 *     "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *     "chainId": 1,
 *     "isPrimary": true,
 *     "createdAt": "2024-01-01T00:00:00Z"
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { id: walletId } = await params;

      // Validate wallet ID
      if (!walletId || typeof walletId !== 'string') {
        apiLog.validationError(apiLogger, requestId, { walletId });

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid wallet ID'
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Set wallet as primary (service validates ownership)
      try {
        const wallet = await userService.setPrimaryWallet(user.id, walletId);

        apiLog.businessOperation(apiLogger, requestId, 'set-primary', 'wallet', wallet.id, {
          userId: user.id,
          address: wallet.address.slice(0, 10) + '...',
        });

        const response = createSuccessResponse({
          id: wallet.id,
          address: wallet.address,
          chainId: wallet.chainId,
          isPrimary: wallet.isPrimary,
          createdAt: wallet.createdAt.toISOString(),
        });

        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

        return NextResponse.json(response, { status: 200 });
      } catch (error) {
        // Check if wallet not found or doesn't belong to user
        if (error instanceof Error) {
          if (error.message.includes('not found') || error.message.includes('does not belong')) {
            apiLog.methodError(
              apiLogger,
              'PATCH /api/v1/user/wallets/[id]/primary',
              error,
              {
                requestId,
                userId: user.id,
                walletId,
              }
            );

            const errorResponse = createErrorResponse(
              ApiErrorCode.WALLET_NOT_FOUND,
              'Wallet not found or does not belong to user',
              { walletId }
            );

            apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.WALLET_NOT_FOUND],
            });
          }
        }
        throw error; // Re-throw unexpected errors
      }
    } catch (error) {
      apiLog.methodError(apiLogger, 'PATCH /api/v1/user/wallets/[id]/primary', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to set primary wallet',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
