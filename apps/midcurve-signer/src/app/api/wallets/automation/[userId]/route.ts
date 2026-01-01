/**
 * GET /api/wallets/automation/[userId] - Get User's Automation Wallet
 *
 * Retrieves the automation wallet for a specific user.
 * Each user has at most one automation wallet.
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

import { NextRequest, NextResponse } from 'next/server';
import {
  automationWalletService,
  AutomationWalletServiceError,
} from '@/services/automation-wallet-service';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/wallets/automation/[userId]
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
    const wallet = await automationWalletService.getWalletByUserId(userId);

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
        keyProvider: wallet.keyProvider,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
        lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AutomationWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error('Error fetching automation wallet:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch automation wallet',
      },
      { status: 500 }
    );
  }
}
