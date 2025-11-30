/**
 * Open Hyperliquid Hedge Endpoint - TEMPORARILY DISABLED
 *
 * POST /api/v1/hedges/hyperliquid/open
 *
 * This endpoint is temporarily disabled during migration from Hyperliquid API wallets
 * to the new KMS-backed Automation Wallet system.
 *
 * The hedge flow will be reimplemented to use intent-based signing via
 * the midcurve-signer service in a future PR.
 *
 * Previous implementation used user-provided Hyperliquid API wallet private keys.
 * New implementation will use KMS-backed automation wallets with EIP-712 intent signing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';
import {
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/hedges/hyperliquid/open
 *
 * TEMPORARILY DISABLED - Returns 503 Service Unavailable
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  // Check authentication (for logging purposes)
  const session = await auth();
  const userId = session?.user?.id ?? 'anonymous';

  apiLogger.warn(
    {
      requestId,
      userId,
      endpoint: '/api/v1/hedges/hyperliquid/open',
    },
    'Hedge opening endpoint is temporarily disabled during migration to automation wallets'
  );

  const errorResponse = createErrorResponse(
    ApiErrorCode.SERVICE_UNAVAILABLE,
    'Hedge opening is temporarily disabled. The feature is being migrated to use KMS-backed automation wallets. Please check back later.',
    {
      migration: 'hyperliquid-api-wallet → automation-wallet',
      status: 'in-progress',
    }
  );

  apiLog.requestEnd(apiLogger, requestId, 503, Date.now() - startTime);

  return NextResponse.json(errorResponse, {
    status: ErrorCodeToHttpStatus[ApiErrorCode.SERVICE_UNAVAILABLE],
  });
}
