/**
 * Single Close Order Endpoint (by semantic identifier)
 *
 * PUT /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash - Create order
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 * PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
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
  CloseOrderHashSchema,
  TRIGGER_MODES,
  SWAP_DIRECTIONS,
} from '@midcurve/api-shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getCloseOrderService,
  getUniswapV3PositionService,
  getPoolSubscriptionService,
  getSharedContractService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { parseCloseOrderHash, hashTypeToTriggerMode } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Path params schema
 */
const PathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  nftId: z.string().regex(/^\d+$/).transform(Number),
  closeOrderHash: CloseOrderHashSchema,
});

/**
 * Update close order request schema
 */
const UpdateCloseOrderRequestSchema = z
  .object({
    sqrtPriceX96Lower: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Lower must be a valid bigint string')
      .optional(),
    sqrtPriceX96Upper: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Upper must be a valid bigint string')
      .optional(),
    slippageBps: z
      .number()
      .int('Slippage must be an integer')
      .min(0, 'Slippage cannot be negative')
      .max(10000, 'Slippage cannot exceed 100%')
      .optional(),
  })
  .refine(
    (data) =>
      data.sqrtPriceX96Lower || data.sqrtPriceX96Upper || data.slippageBps !== undefined,
    { message: 'At least one field must be provided for update' }
  );

/**
 * Create close order request schema
 * Used with PUT to create a new order at the specified closeOrderHash
 */
const CreateCloseOrderRequestSchema = z.object({
  // Pool address
  poolAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address'),

  // Operator address (user's autowallet)
  operatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid operator address'),

  // Position manager (NFPM) address - provided by client from their chain config
  positionManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid position manager address'),

  // Trigger mode (LOWER, UPPER) - BOTH not supported in V1.0 tick-based interface
  triggerMode: z.enum(TRIGGER_MODES, {
    errorMap: () => ({ message: `Trigger mode must be one of: ${TRIGGER_MODES.join(', ')}` }),
  }),

  // Price threshold for the trigger (sqrtPriceX96 format as string)
  sqrtPriceX96: z.string().regex(/^\d+$/, 'sqrtPriceX96 must be a valid bigint string'),

  // Address to receive closed position tokens
  payoutAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid payout address'),

  // Order expiration (ISO date string)
  validUntil: z.string().datetime({ message: 'validUntil must be a valid ISO date string' }),

  // Maximum slippage in basis points (e.g., 50 = 0.5%)
  slippageBps: z.number().int().min(0).max(10000, 'Slippage cannot exceed 100%'),

  // Registration transaction hash
  registrationTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),

  // Optional swap configuration for post-close token swap via Paraswap
  swapConfig: z
    .object({
      enabled: z.boolean(),
      direction: z.enum(SWAP_DIRECTIONS, {
        errorMap: () => ({ message: `Swap direction must be one of: ${SWAP_DIRECTIONS.join(', ')}` }),
      }),
      slippageBps: z.number().int().min(0).max(10000, 'Swap slippage cannot exceed 100%'),
    })
    .optional(),
});

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * PUT /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Create a new close order at the specified hash.
 * The closeOrderHash encodes the order type and tick (e.g., "sl@-12345", "tp@201120").
 * This is an idempotent operation - creating an order that already exists returns 409.
 *
 * The order is created directly in 'active' status since it's already registered on-chain.
 */
export async function PUT(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
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

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Parse closeOrderHash to get order type and tick
      let parsedHash: { type: 'sl' | 'tp'; tick: number };
      try {
        parsedHash = parseCloseOrderHash(closeOrderHash);
      } catch (parseError) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid close order hash format',
          parseError instanceof Error ? parseError.message : String(parseError)
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 3. Parse request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const bodyValidation = CreateCloseOrderRequestSchema.safeParse(body);
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

      const input = bodyValidation.data;

      // 4. Verify trigger mode matches closeOrderHash type
      const expectedTriggerMode = hashTypeToTriggerMode(parsedHash.type);
      if (input.triggerMode !== expectedTriggerMode) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Trigger mode mismatch: closeOrderHash indicates ${expectedTriggerMode} but request specifies ${input.triggerMode}`
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 5. Find position by positionHash
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

      // 6. Check if order already exists
      const closeOrderService = getCloseOrderService();
      const existingOrder = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (existingOrder) {
        // Only reject if the existing order is still active or pending
        // (cannot overwrite an order that's being monitored)
        if (existingOrder.status === 'active' || existingOrder.status === 'pending') {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            `Close order already exists with hash ${closeOrderHash} (status: ${existingOrder.status})`
          );

          apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

          return NextResponse.json(errorResponse, { status: 409 });
        }

        // Order exists but is in terminal state (cancelled/executed/expired/failed)
        // Delete it to allow creating a new order at the same hash
        apiLogger.info({
          requestId,
          orderId: existingOrder.id,
          status: existingOrder.status,
          msg: 'Deleting terminal order to allow replacement',
        });

        await closeOrderService.delete(existingOrder.id);
      }

      // 7. Get shared contract for this chain
      const sharedContractService = getSharedContractService();
      const sharedContract = await sharedContractService.findLatestByChainAndName(
        chainId,
        'UniswapV3PositionCloser'
      );

      if (!sharedContract) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `No automation contract found for chain ${chainId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, { status: 404 });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'create',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id }
      );

      // 8. Create the order
      // Set sqrtPriceX96Lower or sqrtPriceX96Upper based on trigger mode
      const sqrtPriceX96Lower =
        input.triggerMode === 'LOWER' ? BigInt(input.sqrtPriceX96) : undefined;
      const sqrtPriceX96Upper =
        input.triggerMode === 'UPPER' ? BigInt(input.sqrtPriceX96) : undefined;

      const order = await closeOrderService.register({
        closeOrderType: 'uniswapv3',
        positionId: position.id,
        automationContractConfig: {
          chainId,
          contractAddress: sharedContract.config.address,
          positionManager: input.positionManager,
        },
        closeId: 0, // V1.0 doesn't use closeId - orders identified by (nftId, orderType)
        nftId: BigInt(nftId),
        poolAddress: input.poolAddress,
        triggerMode: input.triggerMode,
        sqrtPriceX96Lower,
        sqrtPriceX96Upper,
        payoutAddress: input.payoutAddress,
        operatorAddress: input.operatorAddress,
        validUntil: new Date(input.validUntil),
        slippageBps: input.slippageBps,
        swapConfig: input.swapConfig,
        registrationTxHash: input.registrationTxHash,
      });

      // 9. Increment pool subscription count
      try {
        const subscriptionService = getPoolSubscriptionService();
        await subscriptionService.incrementOrderCount(position.pool.id);
      } catch (subError) {
        // Log but don't fail the request
        apiLogger.warn({
          requestId,
          poolId: position.pool.id,
          error: subError instanceof Error ? subError.message : String(subError),
          msg: 'Failed to increment pool subscription count',
        });
      }

      // 10. Serialize and return
      const serialized = serializeCloseOrder(order);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);

      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'PUT /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to create close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Get a specific close order by its semantic identifier.
 *
 * Path parameters:
 * - chainId: EVM chain ID
 * - nftId: Uniswap V3 NFT token ID
 * - closeOrderHash: Semantic identifier (e.g., "sl@-12345", "tp@201120")
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
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

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Find position by positionHash
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
        'get',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id }
      );

      // 3. Find close order by position + hash
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 4. Serialize and return
      const serialized = serializeCloseOrder(order);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Update a close order's configuration (slippage, price thresholds).
 * Only allowed when order is in 'pending' or 'active' status.
 */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
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

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Parse request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const bodyValidation = UpdateCloseOrderRequestSchema.safeParse(body);
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

      // 4. Find close order by position + hash
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 5. Validate state allows updates
      if (order.status !== 'pending' && order.status !== 'active') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_REQUEST,
          `Cannot update order in '${order.status}' status. Only 'pending' or 'active' orders can be updated.`
        );

        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

        return NextResponse.json(errorResponse, { status: 409 });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'update',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id, orderId: order.id }
      );

      // 6. Update order (use internal id)
      const updateData = bodyValidation.data;
      const updatedOrder = await closeOrderService.update(order.id, {
        sqrtPriceX96Lower: updateData.sqrtPriceX96Lower
          ? BigInt(updateData.sqrtPriceX96Lower)
          : undefined,
        sqrtPriceX96Upper: updateData.sqrtPriceX96Upper
          ? BigInt(updateData.sqrtPriceX96Upper)
          : undefined,
        slippageBps: updateData.slippageBps,
      });

      // 7. Serialize and return
      const serialized = serializeCloseOrder(updatedOrder);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'PATCH /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to update close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash
 *
 * Cancel a close order.
 * Not allowed when order is in terminal state (executed, cancelled, expired, failed).
 */
export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ chainId: string; nftId: string; closeOrderHash: string }> }
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

      const { chainId, nftId, closeOrderHash } = paramsValidation.data;

      // 2. Find position by positionHash
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

      // 3. Find close order by position + hash
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findByPositionAndHash(
        position.id,
        closeOrderHash
      );

      if (!order) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Close order not found',
          `No close order found with hash ${closeOrderHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 4. Validate state allows cancellation
      const terminalStates = ['executed', 'cancelled', 'expired', 'failed'];
      if (terminalStates.includes(order.status)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_REQUEST,
          `Cannot cancel order in '${order.status}' status. Order is already in a terminal state.`
        );

        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

        return NextResponse.json(errorResponse, { status: 409 });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'cancel',
        'close-order',
        closeOrderHash,
        { chainId, nftId, positionId: position.id, orderId: order.id }
      );

      // 5. Cancel order (use internal id)
      const cancelledOrder = await closeOrderService.cancel(order.id);

      // 6. Decrement pool subscription count
      try {
        const subscriptionService = getPoolSubscriptionService();
        await subscriptionService.decrementOrderCount(position.pool.id);
      } catch (subError) {
        // Log but don't fail the request
        apiLogger.warn({
          requestId,
          poolId: position.pool.id,
          error: subError instanceof Error ? subError.message : String(subError),
          msg: 'Failed to decrement pool subscription count',
        });
      }

      // 7. Serialize and return
      const serialized = serializeCloseOrder(cancelledOrder);
      const response = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:closeOrderHash',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to cancel close order',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
