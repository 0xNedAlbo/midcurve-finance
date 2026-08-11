/**
 * POST /api/operator/nonce/release
 *
 * Hand back a nonce that was allocated for signing but whose transaction never reached the
 * chain — a rejected broadcast, or a signature that errored after allocation.
 *
 * Without this, a spent-but-unsent number leaves a gap and every later transaction from the
 * operator EOA queues behind a nonce the chain will never see. The refuel path makes that
 * realistic rather than theoretical: it fires precisely when the operator is low on gas, so
 * "the node rejected the transaction" and "the nonce was already allocated" coincide.
 *
 * Best-effort and idempotent-ish: releasing a nonce that is no longer the most recent
 * allocation is a no-op, reported as such. See OperatorNonceService.release.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { operatorNonceService } from '@/services/operator-nonce-service';
import { OperatorKeyService } from '@/services/operator-key-service';
import { signerLogger } from '@/lib/logger';

const logger = signerLogger.child({ endpoint: 'operator-nonce-release' });

const ReleaseNonceSchema = z.object({
  chainId: z.number().int().positive('chainId must be a positive integer'),
  nonce: z.number().int().nonnegative('nonce must be a non-negative integer'),
});

type ReleaseNonceRequest = z.infer<typeof ReleaseNonceSchema>;

export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  const bodyResult = await parseJsonBody<ReleaseNonceRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: bodyResult.error }, requestId },
      { status: 400 }
    );
  }

  const validation = ReleaseNonceSchema.safeParse(bodyResult.data);
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

  const { chainId, nonce } = validation.data;

  // The address is not taken from the caller: the only key this service signs with is the
  // operator's, so accepting an address would let a caller roll back a counter that is not
  // the one it was allocated from.
  const operatorKeyService = OperatorKeyService.getInstance();
  const initialized = await operatorKeyService.isInitialized();
  if (!initialized) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'OPERATOR_NOT_INITIALIZED',
          message: 'Operator wallet not created yet.',
        },
        requestId,
      },
      { status: 404 }
    );
  }
  const address = await operatorKeyService.getOperatorAddress();

  const result = await operatorNonceService.release({ chainId, address, nonce });

  logger.info({
    requestId,
    chainId,
    nonce,
    rolledBack: result.rolledBack,
    msg: 'Processed operator nonce release',
  });

  return NextResponse.json({
    success: true,
    data: { rolledBack: result.rolledBack },
    requestId,
  });
});
