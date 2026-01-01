/**
 * POST /api/wallets/automation - Create Automation Wallet
 *
 * Creates a new per-user automation wallet for position automation.
 * Each user can only have ONE automation wallet (shared across all chains/positions).
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: { userId: string, label?: string }
 *
 * Response:
 * - 201: { success: true, wallet: { id, userId, walletAddress, label, keyProvider, createdAt } }
 * - 400: Invalid request body
 * - 401: Unauthorized
 * - 409: User already has an automation wallet
 * - 500: Server error
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  automationWalletService,
  AutomationWalletServiceError,
} from '@/services/automation-wallet-service';

/**
 * Request body schema
 */
const CreateAutomationWalletSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  label: z.string().min(1).max(100).optional(),
});

type CreateAutomationWalletRequest = z.infer<typeof CreateAutomationWalletSchema>;

/**
 * POST /api/wallets/automation
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // Parse body
  const bodyResult = await parseJsonBody<CreateAutomationWalletRequest>(request);
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
  const validation = CreateAutomationWalletSchema.safeParse(bodyResult.data);
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
    const wallet = await automationWalletService.createWallet({
      userId: validation.data.userId,
      label: validation.data.label,
    });

    return NextResponse.json(
      {
        success: true,
        wallet: {
          id: wallet.id,
          userId: wallet.userId,
          walletAddress: wallet.walletAddress,
          label: wallet.label,
          keyProvider: wallet.keyProvider,
          isActive: wallet.isActive,
          createdAt: wallet.createdAt.toISOString(),
        },
        requestId,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AutomationWalletServiceError) {
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
 * GET /api/wallets/automation - Get Automation Wallet (by query param)
 *
 * Alternative: use /api/wallets/automation/[userId] for path-based lookup
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
    const wallet = await automationWalletService.getWalletByUserId(userId);

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
        keyProvider: wallet.keyProvider,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
        lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
      },
      requestId,
    });
  } catch (error) {
    if (error instanceof AutomationWalletServiceError) {
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
