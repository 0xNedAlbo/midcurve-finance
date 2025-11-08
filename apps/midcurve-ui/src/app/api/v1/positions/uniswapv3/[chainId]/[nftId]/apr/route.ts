/**
 * Uniswap V3 Position APR Periods Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3PositionService, PositionAprService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { AprPathParamsSchema } from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import type { AprPeriodsResponse, AprPeriodData } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uniswapV3PositionService = new UniswapV3PositionService();
const positionAprService = new PositionAprService();

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr
 *
 * Retrieve ordered list of APR periods for a Uniswap V3 position.
 * Periods are returned in descending order by startTimestamp (newest first).
 *
 * Features:
 * - Looks up position by user ID + chain ID + NFT ID
 * - Verifies position ownership (authenticated user must own the position)
 * - Returns all APR periods with financial metrics and APR calculations
 * - Periods ordered newest-first (descending by startTimestamp)
 * - Returns empty array if position has no APR periods (e.g., no COLLECT events yet)
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Array of APR periods with full period data
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "clxxx...",
 *       "positionId": "clxxx...",
 *       "startEventId": "clxxx...",
 *       "endEventId": "clxxx...",
 *       "startTimestamp": "2025-01-15T10:30:00.000Z",
 *       "endTimestamp": "2025-01-22T10:30:00.000Z",
 *       "durationSeconds": 604800,
 *       "costBasis": "10000000000",
 *       "collectedFeeValue": "50000000",
 *       "aprBps": 2609,
 *       "eventCount": 2,
 *       "createdAt": "2025-01-22T10:31:00.000Z",
 *       "updatedAt": "2025-01-22T10:31:00.000Z"
 *     },
 *     // ... more periods (newest first)
 *   ],
 *   "meta": {
 *     "timestamp": "2025-01-22T...",
 *     "count": 1,
 *     "requestId": "..."
 *   }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const validation = AprPathParamsSchema.safeParse(resolvedParams);

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

      // 2. Generate position hash and look up position
      // Format: "uniswapv3/{chainId}/{nftId}"
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
      });

      // Fast indexed lookup by positionHash
      const dbPosition = await uniswapV3PositionService.findByPositionHash(user.id, positionHash);

      // 3. Verify position exists and user owns it
      if (!dbPosition) {
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

      apiLog.businessOperation(apiLogger, requestId, 'fetch', 'apr-periods', dbPosition.id, {
        positionId: dbPosition.id,
        chainId,
        nftId,
      });

      // 4. Retrieve APR periods from service
      // Service returns periods in descending order (startTimestamp DESC)
      const periods = await positionAprService.getAprPeriods(dbPosition.id);

      apiLogger.info(
        {
          requestId,
          positionId: dbPosition.id,
          periodCount: periods.length,
          chainId,
          nftId,
        },
        'APR periods retrieved successfully'
      );

      // 5. Serialize bigints to strings for JSON
      const serializedPeriods = periods.map((period): AprPeriodData =>
        serializeBigInt(period) as unknown as AprPeriodData
      );

      // 6. Create success response
      const response: AprPeriodsResponse = {
        ...createSuccessResponse(serializedPeriods),
        meta: {
          timestamp: new Date().toISOString(),
          count: periods.length,
          requestId,
        },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve APR periods',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
