/**
 * POST /api/sign/test-evm-wallet - Test Automation Wallet Signing
 *
 * Tests the EVM automation wallet signing capability by:
 * 1. Verifying the user's signed intent
 * 2. Signing a test message with the automation wallet
 * 3. Returning the signature and verification proof
 *
 * This endpoint is used to verify that:
 * - The user can sign intents correctly (EIP-712)
 * - The automation wallet can sign transactions
 * - The end-to-end signing flow works
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     userId: string,
 *     signedIntent: { intent: TestWalletIntent, signature: Hex }
 *   }
 *
 * Response:
 * - 200: {
 *     success: true,
 *     walletAddress: Address,
 *     testSignature: Hex,
 *     intentVerified: true,
 *     message: string
 *   }
 * - 400: Invalid request / intent verification failed
 * - 401: Unauthorized
 * - 404: User has no automation wallet
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { keccak256, toHex } from 'viem';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth.js';
import { checkIntent } from '@/lib/intent/index.js';
import { intentVerifier } from '@/lib/intent/intent-verifier.js';
import { getSigner } from '@/lib/kms/index.js';
import { walletService } from '@/services/wallet-service.js';
import { prisma } from '@/lib/prisma.js';
import { signerLogger, signerLog } from '@/lib/logger.js';
import { SignedIntentSchema, type TestWalletIntent, type SignedIntent } from '@midcurve/api-shared';

const logger = signerLogger.child({ endpoint: 'test-evm-wallet' });

/**
 * Request body schema
 */
const TestWalletRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  signedIntent: SignedIntentSchema,
});

type TestWalletRequest = z.infer<typeof TestWalletRequestSchema>;

/**
 * POST /api/sign/test-evm-wallet
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;
  const startTime = Date.now();

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

  const { userId, signedIntent } = validation.data;

  // Verify this is a test-wallet intent
  if (signedIntent.intent.intentType !== 'test-wallet') {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_INTENT_TYPE',
        message: `Expected test-wallet intent, got ${signedIntent.intent.intentType}`,
        requestId,
      },
      { status: 400 }
    );
  }

  const testIntent = signedIntent.intent as TestWalletIntent;

  // Check intent (verifies signature, nonce, expiry, and user authorization)
  // Cast to SignedIntent since Zod validates the shape but infers string for addresses
  const checkResult = await checkIntent(signedIntent as unknown as SignedIntent, {
    userId,
    expectedIntentType: 'test-wallet',
    skipNonceCheck: false,
  });

  if (!checkResult.valid) {
    signerLog.intentVerification(
      logger,
      requestId,
      false,
      `test-wallet:${testIntent.nonce}`,
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

  try {
    // Get signer and sign a test message
    const signer = getSigner();
    const kmsKeyId = checkResult.kmsKeyId!;
    const walletAddress = checkResult.walletAddress!;

    // Create a test message to sign
    const testMessage = `Midcurve Test Signature - ${testIntent.message} - ${requestId}`;
    const messageHash = keccak256(toHex(testMessage));

    // Sign with the automation wallet
    const signatureResult = await signer.signHash(kmsKeyId, messageHash);

    // Record the nonce as used (replay protection)
    await intentVerifier.recordNonceUsed(testIntent);

    // Update wallet last used timestamp
    await walletService.updateLastUsed(userId);

    // Create audit log
    await prisma.signingAuditLog.create({
      data: {
        userId,
        walletAddress,
        operation: 'test-evm-wallet',
        intentHash: keccak256(toHex(JSON.stringify(testIntent))),
        chainId: testIntent.chainId,
        status: 'success',
        requestedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      },
    });

    signerLog.signingOperation(
      logger,
      requestId,
      'test-evm-wallet',
      walletAddress,
      testIntent.chainId,
      true
    );

    return NextResponse.json({
      success: true,
      walletAddress,
      testMessage,
      testSignature: signatureResult.signature,
      intentVerified: true,
      intentSigner: testIntent.signer,
      requestId,
    });
  } catch (error) {
    logger.error({
      requestId,
      userId,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Test signing failed',
    });

    // Create failure audit log
    await prisma.signingAuditLog.create({
      data: {
        userId,
        walletAddress: checkResult.walletAddress ?? 'unknown',
        operation: 'test-evm-wallet',
        intentHash: keccak256(toHex(JSON.stringify(testIntent))),
        chainId: testIntent.chainId,
        status: 'error',
        errorCode: 'SIGNING_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        requestedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      },
    });

    signerLog.signingOperation(
      logger,
      requestId,
      'test-evm-wallet',
      checkResult.walletAddress ?? 'unknown',
      testIntent.chainId,
      false,
      undefined,
      'SIGNING_FAILED'
    );

    return NextResponse.json(
      {
        success: false,
        error: 'SIGNING_FAILED',
        message: 'Failed to sign test message',
        requestId,
      },
      { status: 500 }
    );
  }
});
