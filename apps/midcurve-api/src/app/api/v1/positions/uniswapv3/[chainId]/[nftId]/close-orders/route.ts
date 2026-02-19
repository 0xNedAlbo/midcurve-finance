/**
 * Close Orders Nested Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders - List close orders for position
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
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getCloseOrderService, getUniswapV3PositionService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { OnChainOrderStatus } from '@midcurve/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Path params schema
 */
const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  nftId: z.string().regex(/^\d+$/).transform(Number),
});

/**
 * Query params schema for filtering
 */
const QueryParamsSchema = z.object({
  status: z
    .enum([
      'pending',
      'registering',
      'active',
      'triggering',
      'executed',
      'cancelled',
      'expired',
      'failed',
    ])
    .optional(),
  type: z.enum(['sl', 'tp']).optional(),
});

/**
 * Map old status query param to OnChainCloseOrder filter options.
 */
function statusToFilterOptions(status: string | undefined) {
  if (!status) return {};

  switch (status) {
    case 'pending':
      return { onChainStatus: OnChainOrderStatus.NONE };
    case 'registering':
      return { onChainStatus: OnChainOrderStatus.ACTIVE, monitoringState: 'idle' as const };
    case 'active':
      return { onChainStatus: OnChainOrderStatus.ACTIVE, monitoringState: 'monitoring' as const };
    case 'triggering':
      return { onChainStatus: OnChainOrderStatus.ACTIVE, monitoringState: 'triggered' as const };
    case 'failed':
      return { onChainStatus: OnChainOrderStatus.ACTIVE, monitoringState: 'suspended' as const };
    case 'executed':
      return { onChainStatus: OnChainOrderStatus.EXECUTED };
    case 'cancelled':
      return { onChainStatus: OnChainOrderStatus.CANCELLED };
    case 'expired':
      // No direct mapping — expired is a subset of cancelled
      return { onChainStatus: OnChainOrderStatus.CANCELLED };
    default:
      return {};
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders
 *
 * List all close orders for a specific position.
 *
 * Features:
 * - Validates position exists and belongs to user
 * - Supports filtering by status and order type (sl/tp)
 * - Returns serialized close orders with closeOrderHash
 *
 * Query parameters:
 * - status: Filter by close order status (optional)
 * - type: Filter by order type - 'sl' (stop-loss) or 'tp' (take-profit) (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
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

      const { chainId, nftId } = paramsValidation.data;

      // 2. Parse query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        status: searchParams.get('status') ?? undefined,
        type: searchParams.get('type') ?? undefined,
      };

      const queryValidation = QueryParamsSchema.safeParse(queryParams);
      if (!queryValidation.success) {
        apiLog.validationError(apiLogger, requestId, queryValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          queryValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { status, type } = queryValidation.data;

      // 3. Find position by positionHash
      const positionHash = `uniswapv3/${chainId}/${nftId}`;
      const position = await getUniswapV3PositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!position) {
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

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'close-orders',
        position.id,
        { chainId, nftId, status, type }
      );

      // 4. Fetch close orders for position
      const filterOptions = statusToFilterOptions(status);
      let orders = await getCloseOrderService().findByPositionId(
        position.id,
        filterOptions
      );

      // 5. Filter by type if specified
      if (type) {
        orders = orders.filter((order) => {
          const hash = order.closeOrderHash;
          return hash && hash.startsWith(`${type}@`);
        });
      }

      // 6. Serialize and return
      const serializedOrders = orders.map(serializeCloseOrder);

      const response = createSuccessResponse(serializedOrders);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to list close orders',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
