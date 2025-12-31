/**
 * GET /api/wallets/evm/[userId] - Get User's EVM Automation Wallets
 *
 * Retrieves ALL EVM automation wallets for a specific user (across all strategies).
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Path: userId
 *
 * Response:
 * - 200: { success: true, wallets: [{ strategyAddress, walletAddress, ... }, ...] }
 * - 401: Unauthorized
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { evmWalletService } from '@/services/evm-wallet-service';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/wallets/evm/[userId]
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
    const wallets = await evmWalletService.getWalletsByUserId(userId);

    return NextResponse.json({
      success: true,
      wallets: wallets.map((wallet) => ({
        id: wallet.id,
        strategyAddress: wallet.strategyAddress,
        userId: wallet.userId,
        walletAddress: wallet.walletAddress,
        label: wallet.label,
        keyProvider: wallet.keyProvider,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
        lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error('Error fetching wallets:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch wallets',
      },
      { status: 500 }
    );
  }
}
