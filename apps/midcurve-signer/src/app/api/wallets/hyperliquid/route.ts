/**
 * Hyperliquid Wallet API Endpoints
 *
 * POST /api/wallets/hyperliquid - Import Hyperliquid Wallet
 * GET /api/wallets/hyperliquid - Get Hyperliquid Wallet (by query param)
 *
 * Unlike automation wallets (where we generate keys), Hyperliquid wallets
 * are imported from user-provided private keys created on hyperliquid.xyz.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  hyperliquidWalletService,
  HyperliquidWalletServiceError,
} from '@/services/hyperliquid-wallet-service';

/**
 * Request body schema for importing a wallet
 */
const ImportHyperliquidWalletSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  privateKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format. Expected 0x followed by 64 hex characters.'),
  label: z.string().min(1).max(100).optional(),
  validityDays: z
    .number()
    .int('Validity days must be a whole number')
    .min(1, 'Validity must be at least 1 day')
    .max(180, 'Validity cannot exceed 180 days')
    .optional(),
});

type ImportHyperliquidWalletRequest = z.infer<typeof ImportHyperliquidWalletSchema>;

/**
 * POST /api/wallets/hyperliquid - Import Hyperliquid Wallet
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: { userId: string, privateKey: string, label?: string }
 *
 * Response:
 * - 201: { success: true, wallet: { id, userId, walletAddress, label, createdAt } }
 * - 400: Invalid request body or private key format
 * - 401: Unauthorized
 * - 409: User already has a Hyperliquid wallet or address already registered
 * - 500: Server error
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // Parse body
  const bodyResult = await parseJsonBody<ImportHyperliquidWalletRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_REQUEST',
        message: bodyResult.error,
        requestId,
      },
      { status: 400 }
    );
  }

  // Validate body
  const validation = ImportHyperliquidWalletSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: validation.error.issues.map((i) => i.message).join(', '),
        requestId,
      },
      { status: 400 }
    );
  }

  try {
    const wallet = await hyperliquidWalletService.importWallet({
      userId: validation.data.userId,
      privateKey: validation.data.privateKey as `0x${string}`,
      label: validation.data.label,
      validityDays: validation.data.validityDays,
    });

    return NextResponse.json(
      {
        success: true,
        wallet: {
          id: wallet.id,
          userId: wallet.userId,
          walletAddress: wallet.walletAddress,
          label: wallet.label,
          isActive: wallet.isActive,
          createdAt: wallet.createdAt.toISOString(),
          validUntil: wallet.validUntil?.toISOString() ?? null,
        },
        requestId,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof HyperliquidWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
          requestId,
        },
        { status: error.statusCode }
      );
    }

    throw error; // Let middleware handle unexpected errors
  }
});

/**
 * GET /api/wallets/hyperliquid - Get Hyperliquid Wallet (by query param)
 *
 * Query params:
 * - userId: User ID to look up
 *
 * Response:
 * - 200: { success: true, wallet: {...} | null }
 * - 400: Missing userId query param
 * - 401: Unauthorized
 */
export const GET = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        error: 'MISSING_PARAM',
        message: 'userId query parameter is required',
        requestId,
      },
      { status: 400 }
    );
  }

  try {
    const wallet = await hyperliquidWalletService.getWalletByUserId(userId);

    if (!wallet) {
      return NextResponse.json({
        success: true,
        wallet: null,
        requestId,
      });
    }

    return NextResponse.json({
      success: true,
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        walletAddress: wallet.walletAddress,
        label: wallet.label,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
        lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
        validUntil: wallet.validUntil?.toISOString() ?? null,
      },
      requestId,
    });
  } catch (error) {
    if (error instanceof HyperliquidWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
          requestId,
        },
        { status: error.statusCode }
      );
    }

    throw error;
  }
});
