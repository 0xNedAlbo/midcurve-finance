/**
 * Uniswap V3 Position On-Chain Refresh Endpoint
 *
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/refresh
 *
 * Refreshes a position's state from on-chain data (liquidity, fees, PnL)
 * and persists the updated state to the database.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { GetUniswapV3PositionParamsSchema } from '@midcurve/api-shared';
import { serializeUniswapV3Position, serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  getUniswapV3PositionService,
  getUniswapV3CloseOrderService,
} from '@/lib/services';
import type { GetUniswapV3PositionResponse } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/refresh
 *
 * Refresh a specific Uniswap V3 position from on-chain data.
 *
 * Fetches current liquidity, fees, PnL from the blockchain and updates
 * the database. Returns the refreshed position with active close orders.
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Full position object with current on-chain state
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const validation = GetUniswapV3PositionParamsSchema.safeParse(resolvedParams);

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

      const { chainId, nftId } = validation.data;

      // 2. Generate position hash for lookup
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'refresh-lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
      });

      // 3. Execute lookup and refresh within a transaction for consistency
      const result = await prisma.$transaction(async (tx) => {
        // 3a. Fast indexed lookup by positionHash
        const dbPosition = await getUniswapV3PositionService().findByPositionHash(
          user.id,
          positionHash,
          tx
        );

        if (!dbPosition) {
          return null;
        }

        apiLog.businessOperation(apiLogger, requestId, 'refresh', 'position', dbPosition.id, {
          chainId,
          nftId,
          positionHash,
        });

        // 3b. Refresh position from on-chain data
        const refreshedPosition = await getUniswapV3PositionService().refresh(
          dbPosition.id,
          'latest',
          tx
        );

        // 3c. Fetch active close orders for this position
        const activeCloseOrders = await getUniswapV3CloseOrderService().findByPositionId(
          dbPosition.id,
          { automationState: ['monitoring', 'executing', 'retrying'] },
          tx
        );

        return { position: refreshedPosition, activeCloseOrders };
      });

      // Handle position not found
      if (!result) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No Uniswap V3 position found for chainId ${chainId} and nftId ${nftId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      const { position, activeCloseOrders } = result;

      apiLog.businessOperation(apiLogger, requestId, 'refreshed', 'position', position.id, {
        chainId,
        nftId,
        pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
        currentValue: position.currentValue.toString(),
        unrealizedPnl: position.unrealizedPnl.toString(),
      });

      // 4. Serialize bigints to strings for JSON
      const serializedPosition: GetUniswapV3PositionResponse = {
        ...serializeUniswapV3Position(position),
        activeCloseOrders: activeCloseOrders.map(serializeCloseOrder),
      };

      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/uniswapv3/:chainId/:nftId/refresh',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();

        // Chain not supported
        if (
          error.message.includes('not configured') ||
          error.message.includes('not supported')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            'Chain not supported',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
          });
        }

        // Position/Pool unavailable on chain (burned NFT, chain reset, etc.)
        if (
          errorMessage.includes('has been burned') ||
          errorMessage.includes('token addresses are zero') ||
          errorMessage.includes('zero sqrtpricex96') ||
          errorMessage.includes('all state fields are zero')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.SERVICE_UNAVAILABLE,
            'Position data unavailable on chain',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 503, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 503 });
        }

        // Position not found
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }

        // On-chain read failures (RPC errors, contract errors)
        if (
          error.message.includes('Failed to read') ||
          error.message.includes('contract') ||
          error.message.includes('RPC')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            'Failed to refresh position data from blockchain',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to refresh position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
