/**
 * Hyperliquid API Wallet Management Endpoints
 *
 * GET  /api/v1/user/hyperliquid-wallets - List user's Hyperliquid API wallets
 * POST /api/v1/user/hyperliquid-wallets - Register new Hyperliquid API wallet
 *
 * Authentication: Required (session only, not API key)
 *
 * Security Note: Private keys are encrypted at rest using AES-256-GCM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  registerHyperliquidWalletSchema,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getHyperliquidApiWalletService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/user/hyperliquid-wallets
 *
 * List all Hyperliquid API wallets for the authenticated user.
 * Returns wallet info without sensitive data (no private keys).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  // Session auth only (not API keys)
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
    // Fetch user's wallets
    const wallets = await getHyperliquidApiWalletService().listWallets(
      session.user.id
    );

    // Convert Date objects to ISO strings
    const walletsFormatted = wallets.map((wallet) => ({
      id: wallet.id,
      walletAddress: wallet.walletAddress,
      label: wallet.label,
      environment: wallet.environment,
      isActive: wallet.isActive,
      lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
      createdAt: wallet.createdAt.toISOString(),
      expiresAt: wallet.expiresAt.toISOString(),
    }));

    const response = createSuccessResponse(walletsFormatted);

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      'GET /api/v1/user/hyperliquid-wallets',
      error,
      {
        requestId,
        userId: session.user.id,
      }
    );

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
}

/**
 * POST /api/v1/user/hyperliquid-wallets
 *
 * Register a new Hyperliquid API wallet.
 * The private key is encrypted and stored securely.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  // Session auth only (not API keys)
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
    const validation = registerHyperliquidWalletSchema.safeParse(body);

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

    const { privateKey, label, environment, expiresAt } = validation.data;

    // Register wallet
    const wallet = await getHyperliquidApiWalletService().registerWallet({
      userId: session.user.id,
      privateKey,
      label,
      environment,
      expiresAt: new Date(expiresAt),
    });

    apiLog.businessOperation(
      apiLogger,
      requestId,
      'created',
      'hyperliquid-api-wallet',
      wallet.id,
      {
        userId: session.user.id,
        walletAddress: wallet.walletAddress,
        environment,
      }
    );

    const response = createSuccessResponse({
      id: wallet.id,
      walletAddress: wallet.walletAddress,
      label: wallet.label,
      environment: wallet.environment,
      expiresAt: wallet.expiresAt.toISOString(),
    });

    apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);

    return NextResponse.json(response, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Handle specific errors
    if (errorMessage.includes('already registered')) {
      apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(ApiErrorCode.CONFLICT, errorMessage),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.CONFLICT] }
      );
    }

    if (errorMessage.includes('Invalid private key')) {
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, errorMessage),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] }
      );
    }

    apiLog.methodError(
      apiLogger,
      'POST /api/v1/user/hyperliquid-wallets',
      error,
      {
        requestId,
        userId: session.user.id,
      }
    );

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to register wallet',
      errorMessage
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
