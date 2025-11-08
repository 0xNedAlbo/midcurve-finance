/**
 * Link Wallet Endpoint
 *
 * POST /api/v1/auth/link-wallet
 *
 * Links an additional wallet to the authenticated user's account.
 * User must sign a SIWE message with the new wallet to prove ownership.
 *
 * Authentication: Required (session only)
 *
 * Request:
 * {
 *   "message": "{...SIWE message JSON...}",
 *   "signature": "0x..."
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "wallet_123",
 *     "address": "0xA0b86991...",
 *     "chainId": 1,
 *     "isPrimary": false,
 *     "createdAt": "2024-01-01T00:00:00Z"
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';
import { withAuth } from '@/middleware/with-auth';
import { AuthUserService, AuthNonceService } from '@midcurve/services';
import { normalizeAddress } from '@midcurve/shared';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  LinkWalletRequestSchema,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const userService = new AuthUserService();
const nonceService = new AuthNonceService();

export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();
    try {
      // 1. Parse and validate request body
      const body = await request.json();
      const validation = LinkWalletRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request data',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { message, signature } = validation.data;

      // 2. Parse SIWE message
      let siweMessage: SiweMessage;
      try {
        siweMessage = new SiweMessage(JSON.parse(message));
      } catch (error) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.INVALID_SIWE_MESSAGE,
          'Failed to parse SIWE message',
          error instanceof Error ? error.message : String(error)
        );
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.INVALID_SIWE_MESSAGE],
        });
      }

      // 3. Verify signature
      const result = await siweMessage.verify({ signature });
      if (!result.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.INVALID_SIGNATURE,
          'Invalid SIWE signature'
        );
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.INVALID_SIGNATURE],
        });
      }

      // 4. Validate nonce
      const nonceValid = await nonceService.validateNonce(siweMessage.nonce);
      if (!nonceValid) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NONCE_INVALID,
          'Invalid or expired nonce'
        );
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NONCE_INVALID],
        });
      }

      // 5. Consume nonce (single use)
      await nonceService.consumeNonce(siweMessage.nonce);

      // 6. Normalize wallet address
      const address = normalizeAddress(siweMessage.address);
      const chainId = siweMessage.chainId;

      // 7. Link wallet to user (will throw if already registered)
      try {
        const wallet = await userService.linkWallet(user.id, address, chainId);

        apiLog.businessOperation(apiLogger, requestId, 'linked', 'wallet', wallet.id, {
          userId: user.id,
          address: address.slice(0, 10) + '...',
          chainId,
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
        // Check if wallet already registered
        if (error instanceof Error && error.message.includes('already registered')) {
          apiLog.methodError(apiLogger, 'POST /api/v1/auth/link-wallet', error, {
            requestId,
            userId: user.id,
            address: address.slice(0, 10) + '...',
          });

          const errorResponse = createErrorResponse(
            ApiErrorCode.WALLET_ALREADY_REGISTERED,
            'This wallet is already registered to a user account',
            { address, chainId }
          );

          apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.WALLET_ALREADY_REGISTERED],
          });
        }
        throw error; // Re-throw unexpected errors
      }
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/auth/link-wallet', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to link wallet',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
