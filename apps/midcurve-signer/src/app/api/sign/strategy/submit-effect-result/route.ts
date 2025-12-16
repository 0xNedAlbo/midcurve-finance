/**
 * POST /api/sign/strategy/submit-effect-result - Sign submitEffectResult() Transaction
 *
 * Signs a submitEffectResult() transaction for a strategy contract.
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
 *     strategyId: string,      // Strategy ID
 *     epoch: string,           // uint64 as string
 *     idempotencyKey: string,  // bytes32
 *     ok: boolean,
 *     data: string             // bytes
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

const logger = signerLogger.child({ endpoint: 'sign-strategy-submit-effect-result' });

/**
 * Request body schema
 */
const SignSubmitEffectResultRequestSchema = z.object({
  strategyId: z.string().min(1, 'strategyId is required'),
  epoch: z.string().regex(/^\d+$/, 'epoch must be a numeric string'),
  idempotencyKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'idempotencyKey must be a valid bytes32 hex'),
  ok: z.boolean(),
  data: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, 'data must be valid hex bytes'),
});

type SignSubmitEffectResultRequest = z.infer<typeof SignSubmitEffectResultRequestSchema>;

/**
 * POST /api/sign/strategy/submit-effect-result
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignSubmitEffectResultRequest>(request);
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
  const validation = SignSubmitEffectResultRequestSchema.safeParse(bodyResult.data);
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

  const { strategyId, epoch, idempotencyKey, ok, data } = validation.data;

  logger.info({
    requestId,
    strategyId,
    epoch,
    idempotencyKeyPrefix: idempotencyKey.slice(0, 10) + '...',
    ok,
    dataLength: data.length,
    msg: 'Processing submitEffectResult signing request',
  });

  try {
    // 3. Sign submitEffectResult() transaction
    const result = await strategySigningService.signSubmitEffectResult({
      strategyId,
      epoch,
      idempotencyKey: idempotencyKey as `0x${string}`,
      ok,
      data: data as `0x${string}`,
    });

    logger.info({
      requestId,
      strategyId,
      epoch,
      nonce: result.nonce,
      msg: 'submitEffectResult() transaction signed successfully',
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
        msg: 'submitEffectResult signing failed with known error',
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
      msg: 'Unexpected error during submitEffectResult signing',
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
