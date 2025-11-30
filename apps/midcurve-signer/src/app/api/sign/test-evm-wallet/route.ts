/**
 * POST /api/sign/test-evm-wallet - Test Strategy Intent Verification
 *
 * Tests the strategy intent verification by:
 * 1. Verifying the user's signed strategy intent (EIP-712)
 * 2. Returning verification result
 *
 * This endpoint only verifies the signature structure.
 * No actual signing or transaction execution is performed.
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     userId: string,
 *     chainId: number,
 *     signedIntent: SignedStrategyIntentV1
 *   }
 *
 * Response:
 * - 200: {
 *     success: true,
 *     intentId: string,
 *     strategyType: string,
 *     signer: Address,
 *     walletAddress: Address,
 *     verified: true
 *   }
 * - 400: Invalid request / intent verification failed
 * - 401: Unauthorized
 * - 404: User has no automation wallet
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { checkIntent } from '@/lib/intent';
import { signerLogger, signerLog } from '@/lib/logger';
import {
  SignedStrategyIntentV1Schema,
  ChainIdSchema,
} from '@midcurve/api-shared';

const logger = signerLogger.child({ endpoint: 'test-evm-wallet' });

/**
 * Request body schema
 */
const TestWalletRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: ChainIdSchema,
  signedIntent: SignedStrategyIntentV1Schema,
});

type TestWalletRequest = z.infer<typeof TestWalletRequestSchema>;

/**
 * POST /api/sign/test-evm-wallet
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // Parse body
  const bodyResult = await parseJsonBody<TestWalletRequest>(request);
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

  // Validate body schema
  const validation = TestWalletRequestSchema.safeParse(bodyResult.data);
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

  const { userId, chainId, signedIntent } = validation.data;

  // Check intent (verifies signature and user authorization)
  const checkResult = await checkIntent(signedIntent, {
    userId,
    chainId,
  });

  if (!checkResult.valid) {
    signerLog.intentVerification(
      logger,
      requestId,
      false,
      `strategy:${signedIntent.intent.id}`,
      checkResult.error
    );

    return NextResponse.json(
      {
        success: false,
        error: checkResult.errorCode ?? 'INTENT_CHECK_FAILED',
        message: checkResult.error,
        requestId,
      },
      { status: 400 }
    );
  }

  const intent = checkResult.intent!;

  signerLog.intentVerification(
    logger,
    requestId,
    true,
    `strategy:${intent.id}`
  );

  return NextResponse.json({
    success: true,
    intentId: intent.id,
    strategyType: intent.strategy.strategyType,
    signer: checkResult.signer,
    walletAddress: checkResult.walletAddress,
    verified: true,
    requestId,
  });
});
