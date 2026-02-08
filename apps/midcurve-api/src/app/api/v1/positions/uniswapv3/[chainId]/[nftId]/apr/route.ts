/**
 * Position APR Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr
 *
 * Returns APR (Annual Percentage Rate) periods for a Uniswap V3 position,
 * plus a pre-calculated summary of total APR metrics.
 *
 * APR Calculation:
 * - Each period represents time between two fee collection events
 * - APR = (collectedFeeValue / costBasis) * (365 days / duration) * 10000 (basis points)
 * - Realized APR: From completed fee collection periods
 * - Unrealized APR: From current unclaimed fees (time-weighted)
 * - Total APR: Time-weighted combination of realized and unrealized
 *
 * Use Cases:
 * - Display APR breakdown by period (chart visualization)
 * - Show total APR summary (realized + unrealized + total)
 * - Analyze fee collection performance over time
 * - Compare APR across different positions or strategies
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
  AprPathParamsSchema,
} from '@midcurve/api-shared';
import type { AprPeriodsResponse, AprPeriodData, AprSummaryData } from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PositionService, getUniswapV3AprService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createPreflightResponse(origin);
}

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr
 *
 * Fetch APR periods and summary for a Uniswap V3 position.
 *
 * Features:
 * - Returns all APR periods in descending chronological order
 * - Includes pre-calculated summary (realized, unrealized, total APR)
 * - Ensures users can only access APR data for their own positions
 * - Periods ordered by (startTimestamp DESC)
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Array of APR periods + summary object
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "uuid",
 *       "positionId": "uuid",
 *       "startEventId": "uuid",
 *       "endEventId": "uuid",
 *       "startTimestamp": "2025-01-01T00:00:00.000Z",
 *       "endTimestamp": "2025-01-08T00:00:00.000Z",
 *       "durationSeconds": 604800,
 *       "costBasis": "1000000000",  // bigint as string
 *       "collectedFeeValue": "20000000",
 *       "aprBps": 1040,  // 10.40% APR
 *       "eventCount": 5
 *     },
 *     ...
 *   ],
 *   "summary": {
 *     "realizedAprBps": 1250,        // 12.50% (from completed periods)
 *     "unrealizedAprBps": 350,       // 3.50% (from unclaimed fees)
 *     "totalAprBps": 1600,           // 16.00% (time-weighted total)
 *     "realizedFeeValue": "50000000",
 *     "unrealizedFeeValue": "10000000",
 *     "totalFeeValue": "60000000",
 *     "totalDurationSeconds": 2592000,
 *     "averageCostBasis": "1000000000"
 *   },
 *   "meta": {
 *     "timestamp": "2025-01-20T16:00:00.000Z",
 *     "count": 12,
 *     "requestId": "xyz123"
 *   }
 * }
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
      const dbPosition = await getUniswapV3PositionService().findByPositionHash(user.id, positionHash);

      // Verify position exists and is owned by user
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

      apiLog.businessOperation(apiLogger, requestId, 'fetch-apr', 'position', dbPosition.id, {
        chainId,
        nftId,
        positionHash,
      });

      // 3. Fetch APR periods (ordered descending: newest first)
      const aprPeriods = await getUniswapV3AprService(dbPosition.id).fetchAprPeriods();

      // 4. Calculate APR summary (fetches position, metrics, and periods internally)
      const aprSummary = await getUniswapV3PositionService().fetchAprSummary(dbPosition.id);

      apiLog.businessOperation(apiLogger, requestId, 'apr-fetched', 'position', dbPosition.id, {
        chainId,
        nftId,
        periodCount: aprPeriods.length,
        totalApr: aprSummary.totalApr,
        realizedApr: aprSummary.realizedApr,
        unrealizedApr: aprSummary.unrealizedApr,
      });

      // 6. Serialize bigints to strings for JSON
      const serializedPeriods = serializeBigInt(aprPeriods) as unknown as AprPeriodData[];
      const serializedSummary = serializeBigInt(aprSummary) as unknown as AprSummaryData;

      const response: AprPeriodsResponse = {
        ...createSuccessResponse(serializedPeriods),
        summary: serializedSummary,
        meta: {
          timestamp: new Date().toISOString(),
          count: aprPeriods.length,
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

      // Map service errors to API error codes
      if (error instanceof Error) {
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
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch position APR',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
