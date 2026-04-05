/**
 * Vault Position Discovery Endpoint
 *
 * POST /api/v1/positions/uniswapv3-vault/discover
 *
 * Discovers a specific UniswapV3 vault position by vault address and imports
 * it into the user's portfolio. Called after the frontend creates a vault
 * via the VaultFactory contract.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { getUniswapV3VaultPositionService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DiscoverVaultRequestSchema = z.object({
  chainId: z.number().int().positive(),
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    const body = await request.json();
    const validation = DiscoverVaultRequestSchema.safeParse(body);

    if (!validation.success) {
      apiLog.validationError(apiLogger, requestId, validation.error.errors);
      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid request data',
        validation.error.errors,
      );
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
      });
    }

    const { chainId, vaultAddress } = validation.data;

    const position = await getUniswapV3VaultPositionService().discover(
      user.id,
      {
        chainId,
        vaultAddress,
        userAddress: user.address,
      },
    );

    apiLog.businessOperation(
      apiLogger,
      requestId,
      'discovered',
      'vault-position',
      user.id,
      { chainId, vaultAddress, positionId: position.id },
    );

    const responseData = { positionId: position.id, positionHash: position.positionHash };
    const response = createSuccessResponse(responseData);
    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
    return NextResponse.json(response, { status: 200 });
  });
}
