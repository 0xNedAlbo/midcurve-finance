/**
 * Uniswap V3 Position Import Endpoint
 *
 * POST /api/v1/positions/uniswapv3/import
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { UniswapV3PositionService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { ImportUniswapV3PositionRequestSchema } from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import type { ImportUniswapV3PositionData } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uniswapV3PositionService = new UniswapV3PositionService();

/**
 * POST /api/v1/positions/uniswapv3/import
 *
 * Import a Uniswap V3 position by NFT ID for the authenticated user.
 *
 * Features:
 * - Automatic quote token detection (respects user preferences)
 * - Duplicate prevention (idempotent - returns existing position if already imported)
 * - Reads position data from on-chain
 * - Discovers and links pool
 * - Calculates PnL and metrics
 *
 * Request body:
 * {
 *   "chainId": 1,        // EVM chain ID (1 = Ethereum, 42161 = Arbitrum, etc.)
 *   "nftId": 123456      // Uniswap V3 NFT token ID
 * }
 *
 * Returns: Full position object with nested pool and token details
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "uuid",
 *     "protocol": "uniswapv3",
 *     "currentValue": "1500000000",  // bigint as string
 *     "pool": {
 *       "id": "uuid",
 *       "token0": { "symbol": "USDC", ... },
 *       "token1": { "symbol": "WETH", ... },
 *       ...
 *     },
 *     "config": { "chainId": 1, "nftId": 123456, ... },
 *     "state": { "liquidity": "...", ... },
 *     ...
 *   }
 * }
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate request body
      const body = await request.json();
      const validation = ImportUniswapV3PositionRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request data',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = validation.data;

      // 2. Import position (quote token auto-detected by service)
      const position = await uniswapV3PositionService.discover(user.id, {
        chainId,
        nftId,
        // quoteTokenAddress omitted → service uses QuoteTokenService
        // This respects user preferences → chain defaults → token0 fallback
      });

      apiLog.businessOperation(apiLogger, requestId, 'imported', 'position', position.id, {
        chainId,
        nftId,
        pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
        quoteToken: position.isToken0Quote
          ? position.pool.token0.symbol
          : position.pool.token1.symbol,
      });

      // 3. Serialize bigints to strings for JSON
      // The position object contains bigint values (currentValue, liquidity, etc.)
      // which cannot be directly serialized to JSON. We recursively convert them to strings.
      const serializedPosition = serializeBigInt(position) as ImportUniswapV3PositionData;

      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/uniswapv3/import',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Invalid address format
        if (error.message.includes('Invalid') && error.message.includes('address')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.INVALID_ADDRESS,
            'Invalid address format',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.INVALID_ADDRESS],
          });
        }

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

        // Position/NFT not found
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist') ||
          error.message.includes('NFT')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found or NFT does not exist',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }

        // On-chain read failures
        if (
          error.message.includes('Failed to read') ||
          error.message.includes('contract') ||
          error.message.includes('RPC')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            'Failed to read position data from blockchain',
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
        'Failed to import position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
