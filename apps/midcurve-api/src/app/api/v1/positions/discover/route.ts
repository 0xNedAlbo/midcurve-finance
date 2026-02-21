/**
 * Position Discovery (Wallet Scan) Endpoint
 *
 * POST /api/v1/positions/discover
 *
 * Scans the authenticated user's wallet for active UniswapV3 positions
 * across selected (or all) chains. Blocking request — returns when scan
 * completes. Publishes position.created domain events for downstream
 * processing (range monitor, etc.).
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  DiscoverPositionsRequestSchema,
} from '@midcurve/api-shared';
import type { DiscoverPositionsData } from '@midcurve/api-shared';
import {
  getDomainEventPublisher,
  type PositionCreatedPayload,
} from '@midcurve/services';
import { getUniswapV3PositionService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { apiLogger, apiLog } from '@/lib/logger';
import type { Address } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/positions/discover
 *
 * Scan the authenticated user's wallet for UniswapV3 positions across chains.
 *
 * Request body:
 * {
 *   "chainIds": [1, 42161, 8453]  // optional — defaults to all supported chains
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": { "found": 5, "imported": 3, "skipped": 2, "errors": 0 }
 * }
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate request body
      const body = await request.json();
      const validation = DiscoverPositionsRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request data',
          validation.error.errors,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainIds } = validation.data;

      // 2. Run wallet position discovery
      const result =
        await getUniswapV3PositionService().discoverWalletPositions(
          user.id,
          user.address as Address,
          chainIds,
        );

      // 3. Publish position.created domain events for downstream processing
      const eventPublisher = getDomainEventPublisher();
      for (const position of result.positions) {
        await eventPublisher.createAndPublish<PositionCreatedPayload>({
          type: 'position.created',
          entityType: 'position',
          entityId: position.id,
          userId: position.userId,
          payload: position.toJSON(),
          source: 'api',
        });
      }

      // 4. Return stats
      const responseData: DiscoverPositionsData = {
        found: result.found,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      };

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'discovered',
        'positions',
        user.id,
        {
          found: result.found,
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors,
        },
      );

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/discover',
        error,
        { requestId },
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to scan for positions',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
