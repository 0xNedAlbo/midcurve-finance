/**
 * POST /api/wallets - Create Automation Wallet
 *
 * Creates a new EVM automation wallet for a user.
 * The wallet is backed by AWS KMS (or local encryption in dev).
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: { userId: string, label: string }
 *
 * Response:
 * - 201: { success: true, wallet: { id, userId, walletAddress, label, keyProvider, createdAt } }
 * - 400: Invalid request body
 * - 401: Unauthorized
 * - 409: User already has a wallet
 * - 500: Server error
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { walletService, WalletServiceError } from '@/services/wallet-service';

/**
 * Request body schema
 */
const CreateWalletSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  label: z.string().min(1, 'label is required').max(100, 'label too long'),
});

type CreateWalletRequest = z.infer<typeof CreateWalletSchema>;

/**
 * POST /api/wallets
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // Parse body
  const bodyResult = await parseJsonBody<CreateWalletRequest>(request);
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
  const validation = CreateWalletSchema.safeParse(bodyResult.data);
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
    const wallet = await walletService.createWallet(validation.data);

    return NextResponse.json(
      {
        success: true,
        wallet: {
          id: wallet.id,
          userId: wallet.userId,
          walletAddress: wallet.walletAddress,
          label: wallet.label,
          keyProvider: wallet.keyProvider,
          createdAt: wallet.createdAt.toISOString(),
        },
        requestId,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof WalletServiceError) {
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
