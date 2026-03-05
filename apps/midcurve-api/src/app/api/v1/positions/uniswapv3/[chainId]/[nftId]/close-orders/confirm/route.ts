/**
 * Close Order Transaction Confirmation Endpoint
 *
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/confirm
 *   - Extract close order events from a transaction receipt and publish them
 *
 * Replaces real-time on-chain event polling for user-initiated actions.
 * The user submits the tx hash after registering, cancelling, or modifying
 * close orders via the UI. Events are extracted from the receipt and published
 * to the close-order-events exchange for downstream processing.
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
import {
  SharedContractService,
  SharedContractNameEnum,
  publishCloseOrderEventsFromReceipt,
} from '@midcurve/services';
import type { EvmSmartContractConfigData } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { getRabbitMQChannel } from '@/lib/rabbitmq';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Path params schema
 */
const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  nftId: z.string().regex(/^\d+$/),
});

/**
 * Request body schema
 */
const BodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format'),
});

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/confirm
 *
 * Extract close order events from a confirmed transaction and publish them.
 *
 * Request body:
 * {
 *   "txHash": "0x..."
 * }
 *
 * Response:
 * {
 *   "data": { "eventsPublished": 2 }
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
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

      const { chainId } = paramsValidation.data;

      // 2. Parse and validate request body
      const body = await request.json();
      const bodyValidation = BodySchema.safeParse(body);

      if (!bodyValidation.success) {
        apiLog.validationError(apiLogger, requestId, bodyValidation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          bodyValidation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { txHash } = bodyValidation.data;

      // 3. Look up the closer contract address for this chain
      const sharedContractService = new SharedContractService();
      const contract = await sharedContractService.findLatestByChainAndName(
        chainId,
        SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER
      );

      if (!contract) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `No UniswapV3PositionCloser contract configured for chain ${chainId}`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const config = contract.config as EvmSmartContractConfigData;
      const contractAddress = config.address;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'confirm',
        'close-order-tx',
        txHash,
        { chainId, contractAddress }
      );

      // 4. Get RabbitMQ channel and publish events from receipt
      const channel = await getRabbitMQChannel();
      const result = await publishCloseOrderEventsFromReceipt(
        channel,
        chainId,
        txHash as `0x${string}`,
        contractAddress,
      );

      apiLogger.info({
        requestId,
        chainId,
        txHash,
        eventsPublished: result.eventsPublished,
        msg: 'Close order events published from receipt',
      });

      const response = createSuccessResponse({
        eventsPublished: result.eventsPublished,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/confirm',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to confirm close order transaction',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
