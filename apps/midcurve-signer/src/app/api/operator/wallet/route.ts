/**
 * POST /api/operator/wallet
 *
 * Creates the operator wallet (or returns the existing one).
 * Idempotent — called by the automation service on startup to ensure
 * the operator key exists before processing any orders.
 */

import { NextResponse } from 'next/server';
import {
  withInternalAuth,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { OperatorKeyService } from '@/services/operator-key-service';

export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const operatorKeyService = OperatorKeyService.getInstance();
  const address = await operatorKeyService.createOperatorKey();

  return NextResponse.json({
    success: true,
    data: { address },
    requestId: ctx.requestId,
  });
});
