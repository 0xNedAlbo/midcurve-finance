/**
 * GET /api/operator/address
 *
 * Returns the operator's Ethereum address.
 * Used by the automation service to set feeRecipient and estimate gas.
 */

import { NextResponse } from 'next/server';
import {
  withInternalAuth,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { OperatorKeyService } from '@/services/operator-key-service';

export const GET = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const operatorKeyService = OperatorKeyService.getInstance();
  const address = operatorKeyService.getOperatorAddress();

  return NextResponse.json({
    success: true,
    data: { address },
    requestId: ctx.requestId,
  });
});
