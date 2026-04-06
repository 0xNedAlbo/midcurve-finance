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
  shareOwnerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
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

    const { chainId, vaultAddress, shareOwnerAddress } = validation.data;

    try {
      const position = await getUniswapV3VaultPositionService().discover(
        user.id,
        {
          chainId,
          vaultAddress,
          ownerAddress: shareOwnerAddress,
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
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/uniswapv3-vault/discover',
        error,
        { requestId },
      );

      const message = error instanceof Error ? error.message : String(error);

      if (message.startsWith('INVALID_VAULT_CONTRACT')) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_REQUEST,
          'Not a valid vault contract',
          message,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
        });
      }

      if (
        message.includes('not configured') ||
        message.includes('not supported')
      ) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CHAIN_NOT_SUPPORTED,
          'Chain not supported',
          message,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
        });
      }

      if (
        message.includes('contract') ||
        message.includes('RPC') ||
        message.includes('Failed to read')
      ) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_REQUEST,
          'Failed to read vault data from blockchain',
          message,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
        });
      }

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to discover vault position',
        message,
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
