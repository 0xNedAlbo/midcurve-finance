/**
 * Position Ledger Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger
 *
 * Returns the complete ledger of events for a Uniswap V3 position, ordered
 * chronologically (descending by blockNumber -> transactionIndex -> logIndex).
 *
 * The ledger provides a complete audit trail of all position state changes:
 * - INCREASE_POSITION: Liquidity added to position
 * - DECREASE_POSITION: Liquidity removed from position
 * - COLLECT: Fees and/or rewards collected
 *
 * Each event includes:
 * - Timestamp and blockchain coordinates (block, tx, log index)
 * - Token amounts (token0, token1, rewards)
 * - Quote-token-denominated values (pool price at event time)
 * - PnL tracking (deltaCostBasis, costBasisAfter, deltaPnl, pnlAfter)
 * - Protocol-specific metadata (Uniswap V3 state)
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
  LedgerPathParamsSchema,
} from '@midcurve/api-shared';
import type { LedgerEventsResponse, LedgerEventData } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PositionService, getUniswapV3PositionLedgerService } from '@/lib/services';

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
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger
 *
 * Fetch the complete ledger of events for a Uniswap V3 position.
 *
 * Features:
 * - Returns all ledger events in descending chronological order
 * - Each event includes PnL tracking and quote-token-denominated values
 * - Ensures users can only access ledgers for their own positions
 * - Ordered by (blockNumber DESC, transactionIndex DESC, logIndex DESC)
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Array of ledger events with PnL and value tracking
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "uuid",
 *       "positionId": "uuid",
 *       "protocol": "uniswapv3",
 *       "timestamp": "2025-01-20T15:30:00.000Z",
 *       "eventType": "COLLECT",
 *       "poolPrice": "2000000000000000000000",  // bigint as string
 *       "token0Amount": "500000000",
 *       "token1Amount": "250000000000000000",
 *       "tokenValue": "1000000000",  // Quote-token-denominated value
 *       "deltaPnl": "50000000",
 *       "pnlAfter": "150000000",
 *       "config": { ... },
 *       "state": { ... }
 *     },
 *     ...
 *   ],
 *   "summary": {
 *     "realizedAprBps": 1250,
 *     "unrealizedAprBps": 350,
 *     "totalAprBps": 1600
 *   },
 *   "meta": {
 *     "timestamp": "2025-01-20T16:00:00.000Z",
 *     "count": 42,
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

      apiLog.businessOperation(apiLogger, requestId, 'fetch-ledger', 'position', dbPosition.id, {
        chainId,
        nftId,
        positionHash,
      });

      // 3. Fetch ledger events (ordered descending: newest first)
      const ledgerEvents = await getUniswapV3PositionLedgerService(dbPosition.id).findAll();

      apiLog.businessOperation(apiLogger, requestId, 'ledger-fetched', 'position', dbPosition.id, {
        chainId,
        nftId,
        eventCount: ledgerEvents.length,
      });

      // 4. Serialize events using built-in toJSON() method (handles bigint → string conversion)
      const serializedEvents = ledgerEvents.map((event: { toJSON: () => unknown }) => event.toJSON()) as unknown as LedgerEventData[];

      const response: LedgerEventsResponse = {
        ...createSuccessResponse(serializedEvents),
        meta: {
          timestamp: new Date().toISOString(),
          count: ledgerEvents.length,
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
        'Failed to fetch position ledger',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
