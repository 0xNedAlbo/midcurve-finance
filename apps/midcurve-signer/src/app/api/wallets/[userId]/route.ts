/**
 * GET /api/wallets/[userId] - Get User's Automation Wallet
 *
 * Retrieves the automation wallet for a specific user.
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Path: userId
 *
 * Response:
 * - 200: { success: true, wallet: { ... } }
 * - 401: Unauthorized
 * - 404: Wallet not found
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { walletService } from '@/services/wallet-service';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/wallets/[userId]
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  // We need to handle auth manually for dynamic routes
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Missing Authorization header',
      },
      { status: 401 }
    );
  }

  const providedKey = authHeader.slice(7);
  const expectedKey = process.env.SIGNER_INTERNAL_API_KEY;

  if (!expectedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key',
      },
      { status: 401 }
    );
  }

  const params = await context.params;
  const { userId } = params;

  try {
    const wallet = await walletService.getWalletByUserId(userId);

    if (!wallet) {
      return NextResponse.json(
        {
          success: false,
          error: 'NOT_FOUND',
          message: 'Wallet not found for this user',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        walletAddress: wallet.walletAddress,
        label: wallet.label,
        keyProvider: wallet.keyProvider,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
        lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch wallet',
      },
      { status: 500 }
    );
  }
}
