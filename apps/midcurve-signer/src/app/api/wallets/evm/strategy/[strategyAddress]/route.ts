/**
 * GET /api/wallets/evm/strategy/[strategyAddress] - Get Strategy's EVM Automation Wallet
 *
 * Retrieves the EVM automation wallet for a specific strategy.
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Path: strategyAddress (0x... EVM address)
 *
 * Response:
 * - 200: { success: true, wallet: { id, strategyAddress, userId, walletAddress, ... } }
 * - 401: Unauthorized
 * - 404: Wallet not found
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { evmWalletService } from '@/services/evm-wallet-service';
import type { Address } from 'viem';

interface RouteContext {
  params: Promise<{ strategyAddress: string }>;
}

/**
 * GET /api/wallets/evm/strategy/[strategyAddress]
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
  const { strategyAddress } = params;

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(strategyAddress)) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_ADDRESS',
        message: 'Invalid strategy address format',
      },
      { status: 400 }
    );
  }

  try {
    const wallet = await evmWalletService.getWalletByStrategyAddress(strategyAddress as Address);

    if (!wallet) {
      return NextResponse.json(
        {
          success: false,
          error: 'NOT_FOUND',
          message: 'Wallet not found for this strategy',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      wallet: {
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
