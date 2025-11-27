/**
 * Test Sign Endpoint
 *
 * POST /api/v1/user/hyperliquid-wallets/[id]/test-sign - Test signing with stored wallet
 *
 * Authentication: Required (session only, not API key)
 *
 * This endpoint allows users to verify that their wallet is correctly stored
 * and can be used for signing operations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  testSignRequestSchema,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getHyperliquidApiWalletService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/user/hyperliquid-wallets/[id]/test-sign
 *
 * Test signing a message with the stored wallet.
 * Verifies the wallet is correctly stored and can be decrypted.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();
  const { id: walletId } = await params;

  apiLog.requestStart(apiLogger, requestId, request);

  // Session auth only
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
    // Parse and validate request body
    const body = await request.json();
    const validation = testSignRequestSchema.safeParse(body);

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

    const { message } = validation.data;

    // Test sign
    const result = await getHyperliquidApiWalletService().testSign({
      userId: session.user.id,
      walletId,
      message,
    });

    apiLog.businessOperation(
      apiLogger,
      requestId,
      'test-signed',
      'hyperliquid-api-wallet',
      walletId,
      {
        userId: session.user.id,
        walletAddress: result.walletAddress,
      }
    );

    const response = createSuccessResponse({
      signature: result.signature,
      walletAddress: result.walletAddress,
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Handle specific errors
    if (
      errorMessage.includes('not found') ||
      errorMessage.includes('unauthorized')
    ) {
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(ApiErrorCode.NOT_FOUND, 'Wallet not found'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
      );
    }

    apiLog.methodError(
      apiLogger,
      `POST /api/v1/user/hyperliquid-wallets/${walletId}/test-sign`,
      error,
      { requestId, userId: session.user.id }
    );

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to sign message',
      errorMessage
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
