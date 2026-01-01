/**
 * POST /api/sign/automation/deploy-closer - Sign PositionCloser Deployment
 *
 * Signs a deployment transaction for a UniswapV3PositionCloser contract.
 * Does NOT broadcast the transaction - that is handled by the caller.
 *
 * Prerequisites:
 * - User must have an automation wallet (created on-demand if needed)
 * - POSITION_CLOSER_BYTECODE environment variable must be set
 * - RPC URL for target chain must be configured
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: { userId: string, chainId: number, nfpmAddress: string }
 *
 * Response (Success):
 * - 200: {
 *     success: true,
 *     data: {
 *       signedTransaction: string,
 *       predictedAddress: string,
 *       nonce: number,
 *       txHash: string,
 *       from: string
 *     }
 *   }
 *
 * Response (Error):
 * - 400: Invalid request or insufficient balance
 * - 401: Unauthorized
 * - 500: Signing failed
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  automationSigningService,
  AutomationSigningError,
} from '@/services/automation-signing-service';
import { signerLogger } from '@/lib/logger';
import type { Address } from 'viem';

const logger = signerLogger.child({ endpoint: 'sign-automation-deploy-closer' });

/**
 * Request body schema
 */
const SignDeployCloserSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  nfpmAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid NFPM address'),
});

type SignDeployCloserRequest = z.infer<typeof SignDeployCloserSchema>;

/**
 * POST /api/sign/automation/deploy-closer
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignDeployCloserRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: bodyResult.error,
        },
        requestId,
      },
      { status: 400 }
    );
  }

  // 2. Validate request schema
  const validation = SignDeployCloserSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.issues.map((i) => i.message).join(', '),
        },
        requestId,
      },
      { status: 400 }
    );
  }

  const { userId, chainId, nfpmAddress } = validation.data;

  logger.info({
    requestId,
    userId,
    chainId,
    nfpmAddress,
    msg: 'Processing deploy-closer signing request',
  });

  try {
    // 3. Sign deployment transaction
    const result = await automationSigningService.signDeployCloser({
      userId,
      chainId,
      nfpmAddress: nfpmAddress as Address,
    });

    logger.info({
      requestId,
      userId,
      chainId,
      predictedAddress: result.predictedAddress,
      nonce: result.nonce,
      msg: 'Deploy-closer transaction signed successfully',
    });

    return NextResponse.json({
      success: true,
      data: {
        signedTransaction: result.signedTransaction,
        predictedAddress: result.predictedAddress,
        nonce: result.nonce,
        txHash: result.txHash,
        from: result.from,
      },
      requestId,
    });
  } catch (error) {
    // Handle known signing errors
    if (error instanceof AutomationSigningError) {
      logger.warn({
        requestId,
        userId,
        chainId,
        errorCode: error.code,
        errorMessage: error.message,
        msg: 'Deploy-closer signing failed with known error',
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          requestId,
        },
        { status: error.statusCode }
      );
    }

    // Handle unexpected errors
    logger.error({
      requestId,
      userId,
      chainId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msg: 'Unexpected error during deploy-closer signing',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during signing',
        },
        requestId,
      },
      { status: 500 }
    );
  }
});
