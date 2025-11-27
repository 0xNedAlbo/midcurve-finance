/**
 * Hyperliquid API Wallet Individual Endpoints
 *
 * GET    /api/v1/user/hyperliquid-wallets/[id] - Get wallet details
 * DELETE /api/v1/user/hyperliquid-wallets/[id] - Revoke wallet
 *
 * Authentication: Required (session only, not API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getHyperliquidApiWalletService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/user/hyperliquid-wallets/[id]
 *
 * Get details of a specific wallet.
 */
export async function GET(
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
    const wallet = await getHyperliquidApiWalletService().getWallet(
      session.user.id,
      walletId
    );

    if (!wallet) {
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(ApiErrorCode.NOT_FOUND, 'Wallet not found'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
      );
    }

    const response = createSuccessResponse({
      id: wallet.id,
      walletAddress: wallet.walletAddress,
      label: wallet.label,
      environment: wallet.environment,
      isActive: wallet.isActive,
      lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
      createdAt: wallet.createdAt.toISOString(),
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      `GET /api/v1/user/hyperliquid-wallets/${walletId}`,
      error,
      { requestId, userId: session.user.id }
    );

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to retrieve wallet',
      error instanceof Error ? error.message : String(error)
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}

/**
 * DELETE /api/v1/user/hyperliquid-wallets/[id]
 *
 * Revoke (deactivate) a wallet. The encrypted key is retained but marked inactive.
 */
export async function DELETE(
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
    await getHyperliquidApiWalletService().revokeWallet(
      session.user.id,
      walletId
    );

    apiLog.businessOperation(
      apiLogger,
      requestId,
      'revoked',
      'hyperliquid-api-wallet',
      walletId,
      { userId: session.user.id }
    );

    const response = createSuccessResponse({
      message: 'Wallet revoked successfully',
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Handle specific errors
    if (
      errorMessage.includes('not found') ||
      errorMessage.includes('does not belong')
    ) {
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(ApiErrorCode.NOT_FOUND, 'Wallet not found'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
      );
    }

    if (errorMessage.includes('already revoked')) {
      apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(ApiErrorCode.CONFLICT, errorMessage),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.CONFLICT] }
      );
    }

    apiLog.methodError(
      apiLogger,
      `DELETE /api/v1/user/hyperliquid-wallets/${walletId}`,
      error,
      { requestId, userId: session.user.id }
    );

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to revoke wallet',
      errorMessage
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
