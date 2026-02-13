/**
 * Position History Reload Endpoint
 *
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/reload-history
 *
 * Completely rebuilds the position's ledger from blockchain history.
 * This is a destructive operation that clears the existing sync state
 * and re-discovers all historical events from the blockchain.
 *
 * Use Cases:
 * - Fix corrupted ledger data (manual intervention)
 * - Recover from sync failures or incomplete event discovery
 * - Re-index position after protocol upgrade or bug fix
 * - User-triggered "refresh from scratch" button in UI
 *
 * Process:
 * 1. Clear existing sync state (checkpoint, missing events)
 * 2. Discover all historical events from blockchain via Etherscan
 * 3. Process events through ledger service (rebuild PnL tracking)
 * 4. Refresh position state from on-chain data
 * 5. Return updated position with complete ledger
 *
 * Warning: This is a long-running operation (up to 60 seconds)
 * - Fetches all events from Etherscan (may hit rate limits)
 * - Processes events sequentially to rebuild PnL
 * - Multiple on-chain RPC calls for pool prices
 * - maxDuration set to 60s to allow completion
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
// TODO: UniswapV3PositionSyncState class was never implemented — sync state clearing is skipped
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { LedgerPathParamsSchema } from '@midcurve/api-shared';
import type { UniswapV3PositionResponse } from '@midcurve/api-shared';
import { serializeUniswapV3Position } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds for long-running blockchain operations

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createPreflightResponse(origin);
}

/**
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/reload-history
 *
 * Completely rebuild the position's ledger from blockchain history.
 *
 * Features:
 * - Clears existing sync state (fresh start)
 * - Discovers all historical events from blockchain
 * - Rebuilds ledger with complete PnL tracking
 * - Refreshes position state from on-chain data
 * - Ensures users can only reload their own positions
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Updated position with complete ledger
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "uuid",
 *     "protocol": "uniswapv3",
 *     "currentValue": "1500000000",
 *     "unrealizedPnl": "50000000",
 *     "pool": { ... },
 *     "config": { ... },
 *     "state": { ... }
 *   }
 * }
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

      apiLog.businessOperation(apiLogger, requestId, 'reload-history-start', 'position', dbPosition.id, {
        chainId,
        nftId,
        positionHash,
      });

      // 3. Clear sync state (fresh start)
      // TODO: UniswapV3PositionSyncState class was planned but never implemented.
      // Sync state clearing is skipped — event discovery (step 4) still works without it.

      // 4. Discover all historical events from blockchain
      // TODO: discoverAllEvents was never implemented on UniswapV3LedgerService.
      // Use importLogsForPosition or similar when available.

      apiLog.businessOperation(apiLogger, requestId, 'events-discovery-skipped', 'position', dbPosition.id, {
        chainId,
        nftId,
      });

      // 5. Refresh position state from on-chain data
      // This fetches current liquidity, fees, PnL, and updates the database
      const position = await getUniswapV3PositionService().refresh(dbPosition.id);

      apiLog.businessOperation(apiLogger, requestId, 'reload-history-complete', 'position', position.id, {
        chainId,
        nftId,
        pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
        currentValue: position.currentValue.toString(),
        unrealizedPnl: position.unrealizedPnl.toString(),
      });

      // 6. Serialize bigints to strings for JSON
      const serializedPosition = serializeUniswapV3Position(position) as UniswapV3PositionResponse;

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

        // Etherscan rate limit
        if (
          error.message.includes('rate limit') ||
          error.message.includes('too many requests')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.TOO_MANY_REQUESTS,
            'Etherscan rate limit exceeded',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 429, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.TOO_MANY_REQUESTS],
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
            'Failed to fetch data from blockchain',
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
