/**
 * Reload Position History Endpoint
 *
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/reload-history
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3PositionSyncState } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { GetUniswapV3PositionParamsSchema } from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  getUniswapV3PositionService,
  getUniswapV3PositionLedgerService,
} from '@/lib/services';
import type { GetUniswapV3PositionResponse } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for full history reload

/**
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/reload-history
 *
 * Completely rebuild a position's event history from the blockchain.
 *
 * **What This Does:**
 * 1. Deletes ALL sync state (missing events cleared)
 * 2. Rebuilds complete ledger from blockchain (via discoverAllEvents):
 *    - Deletes ALL existing ledger events
 *    - Refetches events from blockchain explorer
 *    - Recalculates cost basis, PnL, and fees for each event
 *    - Rebuilds APR periods from scratch
 * 3. Recalculates all position metrics (currentValue, unrealizedPnl, etc.)
 * 4. Returns fully refreshed position
 *
 * **When to Use:**
 * - Position data appears incorrect or corrupted
 * - After blockchain reorganization (very rare)
 * - Manual debugging/troubleshooting
 *
 * **Warning:**
 * This operation can take 30-60 seconds for positions with many events.
 * It makes multiple calls to Etherscan and blockchain RPC endpoints.
 *
 * **Features:**
 * - Idempotent: Safe to call multiple times
 * - Atomic: Either fully succeeds or fails (no partial state)
 * - Returns complete enriched position (same as GET endpoint)
 * - Handles positions with 0 to 1000+ events
 *
 * **Path Parameters:**
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * **Returns:** Full position object with refreshed state
 *
 * **Example Response:**
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "id": "uuid",
 *     "protocol": "uniswapv3",
 *     "currentValue": "1500000000",
 *     "unrealizedPnl": "50000000",
 *     "collectedFees": "25000000",
 *     "pool": { ... },
 *     "config": { ... },
 *     "state": { ... }
 *   }
 * }
 * ```
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
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

      // 2. Generate position hash and look up position
      // Format: "uniswapv3/{chainId}/{nftId}"
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
        operation: 'reload-history',
      });

      // Fast indexed lookup by positionHash
      const dbPosition = await getUniswapV3PositionService().findByPositionHash(user.id, positionHash);

      // Verify position exists and user owns it
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

      const positionId = dbPosition.id;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'reload-history-start',
        'position',
        positionId,
        {
          chainId,
          nftId,
          positionHash,
        }
      );

      // 3. Delete sync state (clear missing events)
      apiLogger.info(
        { requestId, positionId, chainId, nftId },
        'Step 1/5: Clearing sync state'
      );

      const syncState = await UniswapV3PositionSyncState.load(prisma, positionId);
      await syncState.delete(prisma);

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'sync-state-cleared',
        'position',
        positionId,
        {
          chainId,
          nftId,
        }
      );

      // 4. Rebuild ledger from blockchain
      // Note: discoverAllEvents() automatically:
      //   - Deletes all existing ledger events
      //   - Refetches events from blockchain explorer
      //   - Recalculates cost basis and PnL
      //   - Rebuilds APR periods (via aprService.refresh())
      apiLogger.info(
        { requestId, positionId, chainId, nftId },
        'Step 2/3: Rebuilding entire event history from blockchain'
      );

      const ledgerService = getUniswapV3PositionLedgerService();
      const events = await ledgerService.discoverAllEvents(positionId);

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'ledger-events-discovered',
        'position',
        positionId,
        {
          chainId,
          nftId,
          eventCount: events.length,
        }
      );

      apiLogger.info(
        { requestId, positionId, chainId, nftId, eventCount: events.length },
        'Step 3/3: Recalculating position metrics'
      );

      // 7. Refresh position (recalculates all metrics)
      const position = await getUniswapV3PositionService().refresh(positionId);

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'reload-history-complete',
        'position',
        position.id,
        {
          chainId,
          nftId,
          pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
          eventCount: events.length,
          currentValue: position.currentValue.toString(),
          unrealizedPnl: position.unrealizedPnl.toString(),
          collectedFees: position.collectedFees.toString(),
          durationMs: Date.now() - startTime,
        }
      );

      // 8. Serialize bigints to strings for JSON
      const serializedPosition = serializeBigInt(position) as GetUniswapV3PositionResponse;

      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/uniswapv3/:chainId/:nftId/reload-history',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
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

        // Blockchain explorer API failures
        if (
          error.message.includes('explorer') ||
          error.message.includes('rate limit') ||
          error.message.includes('API key')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.EXTERNAL_SERVICE_ERROR,
            'Failed to fetch events from blockchain explorer',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.EXTERNAL_SERVICE_ERROR],
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
            'Failed to read data from blockchain',
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
        'Failed to reload position history',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
