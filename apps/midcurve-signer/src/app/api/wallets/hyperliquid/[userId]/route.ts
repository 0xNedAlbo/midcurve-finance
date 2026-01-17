/**
 * Hyperliquid Wallet by User ID API Endpoints
 *
 * GET /api/wallets/hyperliquid/[userId] - Get User's Hyperliquid Wallet
 * DELETE /api/wallets/hyperliquid/[userId] - Delete User's Hyperliquid Wallet
 *
 * Path-based lookup for user's Hyperliquid wallet.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  hyperliquidWalletService,
  HyperliquidWalletServiceError,
} from '@/services/hyperliquid-wallet-service';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * Validate internal API key from Authorization header
 */
function validateAuth(request: NextRequest): { valid: boolean; error?: NextResponse } {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      valid: false,
      error: NextResponse.json(
        {
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Missing Authorization header',
        },
        { status: 401 }
      ),
    };
  }

  const providedKey = authHeader.slice(7);
  const expectedKey = process.env.SIGNER_INTERNAL_API_KEY;

  if (!expectedKey || providedKey !== expectedKey) {
    return {
      valid: false,
      error: NextResponse.json(
        {
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
        { status: 401 }
      ),
    };
  }

  return { valid: true };
}

/**
 * GET /api/wallets/hyperliquid/[userId] - Get User's Hyperliquid Wallet
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Path: userId
 *
 * Response:
 * - 200: { success: true, wallet: {...} | null }
 * - 401: Unauthorized
 * - 500: Server error
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const auth = validateAuth(request);
  if (!auth.valid) {
    return auth.error!;
  }

  const params = await context.params;
  const { userId } = params;

  try {
    const wallet = await hyperliquidWalletService.getWalletByUserId(userId);

    if (!wallet) {
      return NextResponse.json({
        success: true,
        wallet: null,
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
      },
    });
  } catch (error) {
    if (error instanceof HyperliquidWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error('Error fetching Hyperliquid wallet:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch Hyperliquid wallet',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/wallets/hyperliquid/[userId] - Delete User's Hyperliquid Wallet
 *
 * Soft deletes the user's Hyperliquid wallet (marks as inactive).
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Path: userId
 *
 * Response:
 * - 200: { success: true }
 * - 401: Unauthorized
 * - 404: Wallet not found
 * - 500: Server error
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const auth = validateAuth(request);
  if (!auth.valid) {
    return auth.error!;
  }

  const params = await context.params;
  const { userId } = params;

  try {
    await hyperliquidWalletService.deleteWalletByUserId(userId);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    if (error instanceof HyperliquidWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error('Error deleting Hyperliquid wallet:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to delete Hyperliquid wallet',
      },
      { status: 500 }
    );
  }
}
