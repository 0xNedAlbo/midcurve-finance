/**
 * UniswapV3 Vault Position Endpoint
 *
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 * DELETE /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetUniswapV3VaultPositionParamsSchema,
} from '@midcurve/api-shared';
import { serializeUniswapV3VaultPosition } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  getUniswapV3VaultPositionService,
  getUniswapV3CloseOrderService,
} from '@/lib/services';
import { serializeCloseOrder } from '@/lib/serializers';
import type { GetUniswapV3VaultPositionResponse } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 *
 * Fetch a specific vault position from the database.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; vaultAddress: string; ownerAddress: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const validation = GetUniswapV3VaultPositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, vaultAddress, ownerAddress } = validation.data;
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'vault-position', positionHash, {
        chainId,
        vaultAddress,
        userId: user.id,
      });

      const result = await prisma.$transaction(async (tx) => {
        const position = await getUniswapV3VaultPositionService().findByPositionHash(
          user.id,
          positionHash,
          tx
        );

        if (!position) return null;

        const closeOrders = await getUniswapV3CloseOrderService().findByPositionId(
          position.id,
          {},
          tx
        );

        const ownerWalletRow = await tx.position.findUnique({
          where: { id: position.id },
          select: { ownerWallet: true },
        });

        return { position, closeOrders, ownerWallet: ownerWalletRow?.ownerWallet ?? null };
      });

      if (!result) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Vault position not found',
          `No vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      const { position, closeOrders, ownerWallet } = result;

      const serializedPosition: GetUniswapV3VaultPositionResponse = {
        ...serializeUniswapV3VaultPosition(position),
        ownerWallet,
        closeOrders: closeOrders.map(serializeCloseOrder),
      };

      const response = createSuccessResponse(serializedPosition);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress',
        error,
        { requestId }
      );

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('does not exist')) {
          const errorResponse = createErrorResponse(ApiErrorCode.POSITION_NOT_FOUND, 'Position not found', error.message);
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND] });
        }
      }

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch vault position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR] });
    }
  });
}

/**
 * DELETE /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 *
 * Delete a vault position from the database. Idempotent.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; vaultAddress: string; ownerAddress: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const validation = GetUniswapV3VaultPositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, vaultAddress, ownerAddress } = validation.data;
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;

      const dbPosition = await getUniswapV3VaultPositionService().findByPositionHash(user.id, positionHash);

      if (!dbPosition) {
        const response = createSuccessResponse({});
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(response, { status: 200 });
      }

      await getUniswapV3VaultPositionService().delete(dbPosition.id);

      const response = createSuccessResponse({});
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete vault position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR] });
    }
  });
}
