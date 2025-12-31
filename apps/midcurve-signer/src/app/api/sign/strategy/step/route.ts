/**
 * POST /api/sign/strategy/step - Sign step() Transaction
 *
 * Signs a step() transaction for a strategy contract.
 * Does NOT broadcast the transaction - that is handled by midcurve-evm.
 *
 * Prerequisites:
 * - Strategy must exist and be in 'active' state
 * - Automation wallet must exist
 * - Contract must be deployed
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     strategyId: string,  // Strategy ID
 *     stepInput: string    // ABI-encoded step input (bytes)
 *   }
 *
 * Response (Success):
 * - 200: {
 *     success: true,
 *     data: {
 *       signedTransaction: string,
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

const logger = signerLogger.child({ endpoint: 'sign-strategy-step' });

/**
 * Request body schema
 */
const SignStepRequestSchema = z.object({
  strategyId: z.string().min(1, 'strategyId is required'),
  stepInput: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, 'stepInput must be valid hex bytes'),
});

type SignStepRequest = z.infer<typeof SignStepRequestSchema>;

/**
 * POST /api/sign/strategy/step
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignStepRequest>(request);
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
  const validation = SignStepRequestSchema.safeParse(bodyResult.data);
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

  const { strategyId, stepInput } = validation.data;

  logger.info({
    requestId,
    strategyId,
    stepInputLength: stepInput.length,
    msg: 'Processing step signing request',
  });

  try {
    // 3. Sign step() transaction
    const result = await strategySigningService.signStep({
      strategyId,
      stepInput: stepInput as `0x${string}`,
    });

    logger.info({
      requestId,
      strategyId,
      nonce: result.nonce,
      msg: 'step() transaction signed successfully',
    });

    return NextResponse.json({
      success: true,
      data: {
        signedTransaction: result.signedTransaction,
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
        msg: 'step signing failed with known error',
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
      msg: 'Unexpected error during step signing',
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
