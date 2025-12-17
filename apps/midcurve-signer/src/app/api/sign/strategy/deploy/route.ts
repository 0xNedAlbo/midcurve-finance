/**
 * POST /api/sign/strategy/deploy - Sign Strategy Deployment Transaction
 *
 * Signs a deployment transaction for a strategy contract.
 * Does NOT broadcast the transaction - that is handled by midcurve-evm.
 *
 * Prerequisites:
 * - Strategy must exist and be in 'deploying' state
 * - Automation wallet must already be created
 * - Manifest must be attached to strategy
 * - CORE_ADDRESS environment variable must be set
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: { strategyId: string }
 *
 * Note: chainId is not a parameter - we only support local SEMSEE (31337)
 * Note: Constructor params are sourced from manifest (operator-address, core-address, user-input)
 *
 * Response (Success):
 * - 200: {
 *     success: true,
 *     data: {
 *       signedTransaction: string,  // Raw signed tx (0x...)
 *       predictedAddress: string,   // Predicted contract address
 *       nonce: number,
 *       txHash: string
 *     }
 *   }
 *
 * Response (Error):
 * - 400: Invalid request or strategy state
 * - 401: Unauthorized
 * - 404: Strategy, manifest, or wallet not found
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
  strategySigningService,
  StrategySigningError,
} from '@/services/strategy-signing-service';
import { signerLogger } from '@/lib/logger';

const logger = signerLogger.child({ endpoint: 'sign-strategy-deploy' });

/**
 * Request body schema
 * Note: chainId and ownerAddress are not required - handled by service
 */
const SignDeployRequestSchema = z.object({
  strategyId: z.string().min(1, 'strategyId is required'),
});

type SignDeployRequest = z.infer<typeof SignDeployRequestSchema>;

/**
 * POST /api/sign/strategy/deploy
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignDeployRequest>(request);
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
  const validation = SignDeployRequestSchema.safeParse(bodyResult.data);
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

  const { strategyId } = validation.data;

  logger.info({
    requestId,
    strategyId,
    msg: 'Processing deployment signing request',
  });

  try {
    // 3. Sign deployment transaction
    const result = await strategySigningService.signDeployment({
      strategyId,
    });

    logger.info({
      requestId,
      strategyId,
      predictedAddress: result.predictedAddress,
      nonce: result.nonce,
      msg: 'Deployment transaction signed successfully',
    });

    return NextResponse.json({
      success: true,
      data: {
        signedTransaction: result.signedTransaction,
        predictedAddress: result.predictedAddress,
        nonce: result.nonce,
        txHash: result.txHash,
      },
      requestId,
    });
  } catch (error) {
    // Handle known signing errors
    if (error instanceof StrategySigningError) {
      logger.warn({
        requestId,
        strategyId,
        errorCode: error.code,
        errorMessage: error.message,
        msg: 'Deployment signing failed with known error',
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
      strategyId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msg: 'Unexpected error during deployment signing',
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
