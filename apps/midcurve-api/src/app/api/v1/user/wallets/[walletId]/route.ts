/**
 * Single User Wallet Endpoint
 *
 * DELETE /api/v1/user/wallets/:walletId - Remove a non-primary wallet
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUserWalletService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { getDomainEventPublisher, type WalletChangedPayload } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    walletId: string;
  }>;
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * DELETE /api/v1/user/wallets/:walletId
 *
 * Remove a wallet from the user's perimeter. Cannot remove the primary wallet.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const { walletId } = await params;

  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    const wallet = await getUserWalletService().findById(walletId);

    if (!wallet) {
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.NOT_FOUND, 'Wallet not found'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
      );
    }

    // Authorization: wallet must belong to the authenticated user
    if (wallet.userId !== user.id) {
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.NOT_FOUND, 'Wallet not found'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
      );
    }

    // Cannot delete primary wallet
    if (wallet.isPrimary) {
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Cannot remove your primary wallet'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] }
      );
    }

    // Capture wallet details before deletion for the domain event
    const walletConfig = wallet.config as { address: string };

    await getUserWalletService().delete(wallet.id);

    apiLog.businessOperation(apiLogger, requestId, 'deleted', 'userWallet', wallet.id, {
      walletType: wallet.walletType,
      walletHash: wallet.walletHash,
    });

    // Publish wallet.removed domain event for accounting re-evaluation
    const eventPublisher = getDomainEventPublisher();
    await eventPublisher.createAndPublish<WalletChangedPayload>({
      type: 'wallet.removed',
      entityId: user.id,
      entityType: 'wallet',
      payload: {
        userId: user.id,
        walletId: wallet.id,
        walletType: wallet.walletType,
        address: walletConfig.address,
      },
      source: 'api',
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(
      createSuccessResponse({ deleted: true as const }),
      { status: 200 }
    );
  });
}
