/**
 * GET /api/operator/address
 *
 * Returns the operator's Ethereum address.
 * Used by the automation service to set feeRecipient and estimate gas.
 *
 * Returns 404 if the operator wallet has not been created yet.
 */

import { NextResponse } from 'next/server';
import {
  withInternalAuth,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { OperatorKeyService } from '@/services/operator-key-service';

export const GET = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const operatorKeyService = OperatorKeyService.getInstance();
  const initialized = await operatorKeyService.isInitialized();

  if (!initialized) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'OPERATOR_NOT_INITIALIZED',
          message: 'Operator wallet not created yet. Call POST /api/operator/wallet first.',
        },
        requestId: ctx.requestId,
      },
      { status: 404 }
    );
  }

  const address = await operatorKeyService.getOperatorAddress();

  return NextResponse.json({
    success: true,
    data: { address },
    requestId: ctx.requestId,
  });
});
