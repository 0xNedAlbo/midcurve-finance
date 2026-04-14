/**
 * User Wallets Endpoint
 *
 * GET  /api/v1/user/wallets - List authenticated user's wallets
 * POST /api/v1/user/wallets - Add a wallet after ownership verification
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { normalizeAddress } from '@midcurve/shared';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  AddWalletRequestSchema,
  type UserWalletResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUserWalletService, getAuthNonceService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { getDomainEventPublisher, type WalletChangedPayload } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeWallet(wallet: { id: string; walletType: string; walletHash: string; label: string | null; config: unknown; isPrimary: boolean; createdAt: Date; updatedAt: Date }): UserWalletResponse {
  return {
    id: wallet.id,
    walletType: wallet.walletType,
    walletHash: wallet.walletHash,
    label: wallet.label,
    config: wallet.config as Record<string, unknown>,
    isPrimary: wallet.isPrimary,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/user/wallets
 *
 * List all wallets belonging to the authenticated user.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    const wallets = await getUserWalletService().findByUserId(user.id);

    const response = createSuccessResponse({
      wallets: wallets.map(serializeWallet),
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, { status: 200 });
  });
}

/**
 * POST /api/v1/user/wallets
 *
 * Add a wallet after ownership verification (challenge signature).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    const body = await request.json();
    const parseResult = AddWalletRequestSchema.safeParse(body);

    if (!parseResult.success) {
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid request body', parseResult.error.errors),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] }
      );
    }

    const { walletType, address, signature, nonce, label } = parseResult.data;

    // Validate and consume nonce
    const nonceValid = await getAuthNonceService().validateNonce(nonce);
    if (!nonceValid) {
      apiLog.requestEnd(apiLogger, requestId, 401, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'Invalid or expired nonce'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
      );
    }
    await getAuthNonceService().consumeNonce(nonce);

    // Normalize address and reconstruct challenge message
    const normalizedAddress = normalizeAddress(address);
    const challengeMessage = `Midcurve Finance: Verify wallet ownership\n\nAddress: ${normalizedAddress}\nNonce: ${nonce}`;

    // Verify ownership signature
    const isValid = await verifyMessage({
      address: normalizedAddress as `0x${string}`,
      message: challengeMessage,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      apiLog.authFailure(apiLogger, requestId, 'Invalid wallet ownership signature', 'session');
      apiLog.requestEnd(apiLogger, requestId, 401, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'Invalid signature — wallet ownership could not be verified'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED] }
      );
    }

    // Check if wallet is already registered
    const existing = await getUserWalletService().findByTypeAndAddress(walletType, normalizedAddress);
    if (existing) {
      if (existing.userId === user.id) {
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.CONFLICT, 'This wallet is already in your wallet list'),
          { status: 409 }
        );
      }
      apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.CONFLICT, 'This wallet is already registered to another account'),
        { status: 409 }
      );
    }

    // Create the wallet
    const wallet = await getUserWalletService().create({
      userId: user.id,
      walletType,
      address: normalizedAddress,
      label,
      isPrimary: false,
    });

    apiLog.businessOperation(apiLogger, requestId, 'created', 'userWallet', wallet.id, {
      walletType,
      address: normalizedAddress,
    });

    // Publish wallet.added domain event for accounting re-evaluation
    const eventPublisher = getDomainEventPublisher();
    await eventPublisher.createAndPublish<WalletChangedPayload>({
      type: 'wallet.added',
      entityId: user.id,
      entityType: 'wallet',
      payload: {
        userId: user.id,
        walletId: wallet.id,
        walletType,
        address: normalizedAddress,
      },
      source: 'api',
    });

    apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);

    return NextResponse.json(
      createSuccessResponse({ wallet: serializeWallet(wallet) }),
      { status: 201 }
    );
  });
}
