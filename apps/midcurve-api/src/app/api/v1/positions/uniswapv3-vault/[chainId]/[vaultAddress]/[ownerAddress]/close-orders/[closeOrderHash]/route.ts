/**
 * Single Vault Close Order Endpoint (by semantic identifier)
 *
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/close-orders/:closeOrderHash
 *
 * Vault counterpart of the NFT route
 * /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash —
 * same response shape, same error codes.
 *
 * Authentication: Required (session only)
 *
 * Note: no PUT/PATCH/DELETE — the UI calls the contract directly via Wagmi, and
 * the event subscriber (UniswapV3ProcessCloseOrderEventsRule) handles all DB writes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  CloseOrderHashSchema,
} from '@midcurve/api-shared';
import { normalizeAddress } from '@midcurve/shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getUniswapV3CloseOrderService,
  getUniswapV3VaultPositionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Path params schema.
 *
 * Addresses are normalized to EIP-55 so a lowercase address in the URL resolves
 * the same position as a checksummed one — the position hash is built from
 * checksummed addresses.
 */
const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  vaultAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((value) => normalizeAddress(value)),
  ownerAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((value) => normalizeAddress(value)),
  closeOrderHash: CloseOrderHashSchema,
});

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/close-orders/:closeOrderHash
 *
 * Get a specific vault close order by its semantic identifier.
 *
 * Path parameters:
 * - chainId: EVM chain ID
 * - vaultAddress: Vault (ERC-20 share token) address
 * - ownerAddress: Share holder address
 * - closeOrderHash: Semantic identifier (e.g., "sl@-12345", "tp@201120")
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      chainId: string;
      vaultAddress: string;
      ownerAddress: string;
      closeOrderHash: string;
    }>;
  }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const paramsValidation = PathParamsSchema.safeParse(resolvedParams);

      if (!paramsValidation.success) {
        apiLog.validationError(apiLogger, requestId, paramsValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, vaultAddress, ownerAddress, closeOrderHash } =
        paramsValidation.data;

      // 2. Find vault position by positionHash
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;
      const position = await getUniswapV3VaultPositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!position) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Vault position not found',
          `No vault position found for chainId ${chainId}, vaultAddress ${vaultAddress} and ownerAddress ${ownerAddress}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get',
        'close-order',
        closeOrderHash,
        { chainId, vaultAddress, ownerAddress, positionId: position.id }
      );

      // 3. Find close order by position + hash
      const order = await getUniswapV3CloseOrderService().findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 4. Serialize and return
      const serialized = serializeCloseOrder(order);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
