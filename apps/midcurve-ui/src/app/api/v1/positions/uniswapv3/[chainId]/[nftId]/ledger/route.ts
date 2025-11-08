/**
 * Uniswap V3 Position Ledger Events Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3PositionService, UniswapV3PositionLedgerService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { LedgerPathParamsSchema } from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import type { LedgerEventsResponse, LedgerEventData } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uniswapV3PositionService = new UniswapV3PositionService();
const uniswapV3PositionLedgerService = new UniswapV3PositionLedgerService();

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger
 *
 * Retrieve ordered list of position ledger events for a Uniswap V3 position.
 * Events are returned in descending order by blockchain coordinates (blockNumber→txIndex→logIndex).
 *
 * Features:
 * - Looks up position by user ID + chain ID + NFT ID
 * - Verifies position ownership (authenticated user must own the position)
 * - Returns all ledger events with financial data (cost basis, PnL, fees)
 * - Events ordered newest-first (descending by blockNumber, txIndex, logIndex)
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Array of ledger events with full event data
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "clxxx...",
 *       "positionId": "clxxx...",
 *       "protocol": "uniswapv3",
 *       "eventType": "INCREASE_POSITION",
 *       "timestamp": "2025-01-15T10:30:00.000Z",
 *       "poolPrice": "2000000000",
 *       "token0Amount": "1000000",
 *       "token1Amount": "2000000000000000000",
 *       "tokenValue": "3000000000",
 *       "rewards": [],
 *       "deltaCostBasis": "3000000000",
 *       "costBasisAfter": "3000000000",
 *       "deltaPnl": "0",
 *       "pnlAfter": "0",
 *       "config": { ... },
 *       "state": { ... },
 *       "previousId": null,
 *       "createdAt": "2025-01-15T10:31:00.000Z",
 *       "updatedAt": "2025-01-15T10:31:00.000Z"
 *     },
 *     // ... more events (newest first)
 *   ],
 *   "meta": {
 *     "timestamp": "2025-01-22T...",
 *     "count": 15
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
      const validation = LedgerPathParamsSchema.safeParse(resolvedParams);

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

      apiLog.businessOperation(apiLogger, requestId, 'fetch', 'ledger-events', dbPosition.id, {
        positionId: dbPosition.id,
        chainId,
        nftId,
      });

      // 4. Retrieve ledger events from service
      // Service returns events in descending order (blockNumber DESC, txIndex DESC, logIndex DESC)
      const events = await uniswapV3PositionLedgerService.findAllItems(dbPosition.id);

      apiLogger.info(
        {
          requestId,
          positionId: dbPosition.id,
          eventCount: events.length,
          chainId,
          nftId,
        },
        'Ledger events retrieved successfully'
      );

      // 5. Serialize bigints to strings for JSON
      const serializedEvents = events.map((event): LedgerEventData =>
        serializeBigInt(event) as unknown as LedgerEventData
      );

      // 6. Create success response
      const response: LedgerEventsResponse = {
        ...createSuccessResponse(serializedEvents),
        meta: {
          timestamp: new Date().toISOString(),
          count: events.length,
          requestId,
        },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve ledger events',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
