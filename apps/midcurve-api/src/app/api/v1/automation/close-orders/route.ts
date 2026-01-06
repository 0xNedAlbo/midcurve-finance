/**
 * Automation Close Orders API Endpoints
 *
 * POST /api/v1/automation/close-orders - Register close order after on-chain registration
 * GET /api/v1/automation/close-orders - List user's close orders
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
} from '@midcurve/api-shared';
import type { TriggerMode } from '@midcurve/shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getCloseOrderService,
  getPoolSubscriptionService,
  getUniswapV3PositionService,
  getPositionListService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { isChainSupported } from '@/config/shared-contracts';
import type { UniswapV3Position } from '@midcurve/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Request body schema for registering a close order
 *
 * In the shared contract model, the user registers on-chain first,
 * then calls this endpoint to notify the API.
 */
const RegisterCloseOrderRequestSchema = z.object({
  // Close order type (protocol)
  closeOrderType: z.literal('uniswapv3'),

  // Position reference
  positionId: z.string().min(1),

  // Contract config (immutable at registration)
  automationContractConfig: z.object({
    chainId: z.number().int().positive(),
    contractAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
    positionManager: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid position manager address'),
  }),

  // Order config from on-chain registration
  closeId: z.number().int().nonnegative(),
  nftId: z.string().regex(/^\d+$/, 'Invalid NFT ID'),
  poolAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address'),
  operatorAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid operator address'),
  triggerMode: z.enum(['LOWER', 'UPPER', 'BOTH']),
  sqrtPriceX96Lower: z.string().optional(),
  sqrtPriceX96Upper: z.string().optional(),
  priceLowerDisplay: z.string().optional(),
  priceUpperDisplay: z.string().optional(),
  payoutAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid payout address'),
  validUntil: z.string().datetime(),
  slippageBps: z.number().int().min(0).max(10000),

  // Registration proof
  registrationTxHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
});

/**
 * Query schema for listing close orders
 */
const ListCloseOrdersQuerySchema = z.object({
  closeOrderType: z.literal('uniswapv3').optional(),
  status: z.string().optional(),
  positionId: z.string().optional(),
});

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/automation/close-orders
 *
 * Register a close order after on-chain registration.
 * The user signs registerClose() on-chain, then calls this endpoint.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse JSON body
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

      // Validate request
      const validation = RegisterCloseOrderRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const data = validation.data;

      // Validate chain is supported
      if (
        !isChainSupported('uniswapv3', data.automationContractConfig.chainId)
      ) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Chain ${data.automationContractConfig.chainId} is not supported for close orders`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'register',
        'close-order',
        user.id,
        {
          closeOrderType: data.closeOrderType,
          positionId: data.positionId,
          chainId: data.automationContractConfig.chainId,
          closeId: data.closeId,
        }
      );

      // Verify position exists and belongs to user
      const positionService = getUniswapV3PositionService();
      const position = (await positionService.findById(
        data.positionId
      )) as UniswapV3Position | null;

      if (!position) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Position not found: ${data.positionId}`
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      if (position.userId !== user.id) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'You do not have access to this position'
        );
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 403 });
      }

      // Ensure pool subscription exists for price monitoring
      const subscriptionService = getPoolSubscriptionService();
      await subscriptionService.ensureSubscription(position.pool.id);

      // Register the close order in database
      // NOTE: Store the ORIGINAL values from the UI/on-chain registration.
      // The price monitor handles isToken0Quote inversion during trigger detection.
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.register({
        closeOrderType: data.closeOrderType,
        positionId: data.positionId,
        automationContractConfig: data.automationContractConfig,
        closeId: data.closeId,
        nftId: BigInt(data.nftId),
        poolAddress: data.poolAddress,
        operatorAddress: data.operatorAddress,
        triggerMode: data.triggerMode as TriggerMode,
        sqrtPriceX96Lower: data.sqrtPriceX96Lower
          ? BigInt(data.sqrtPriceX96Lower)
          : undefined,
        sqrtPriceX96Upper: data.sqrtPriceX96Upper
          ? BigInt(data.sqrtPriceX96Upper)
          : undefined,
        priceLowerDisplay: data.priceLowerDisplay,
        priceUpperDisplay: data.priceUpperDisplay,
        payoutAddress: data.payoutAddress,
        validUntil: new Date(data.validUntil),
        slippageBps: data.slippageBps,
        registrationTxHash: data.registrationTxHash,
      });

      // Increment pool subscription order count
      await subscriptionService.incrementOrderCount(position.pool.id);

      // Serialize and return
      const serialized = serializeCloseOrder(order);

      const response = createSuccessResponse(serialized);
      apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);
      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/automation/close-orders',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to register close order'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}

/**
 * GET /api/v1/automation/close-orders
 *
 * List all close orders for the authenticated user.
 * Supports filtering by closeOrderType, status, positionId.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        closeOrderType: searchParams.get('closeOrderType') ?? undefined,
        status: searchParams.get('status') ?? undefined,
        positionId: searchParams.get('positionId') ?? undefined,
      };

      const validation = ListCloseOrdersQuerySchema.safeParse(queryParams);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const { closeOrderType, status, positionId } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'close-orders',
        user.id,
        { closeOrderType, status, positionId }
      );

      // Get user's positions to filter orders
      const positionListService = getPositionListService();
      const positionResult = await positionListService.list(user.id, {
        limit: 1000, // Get all positions
      });
      const userPositionIds = positionResult.positions.map((p) => p.id);

      if (userPositionIds.length === 0) {
        // User has no positions, so no orders
        const response = createSuccessResponse([]);
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(response, { status: 200 });
      }

      // Fetch orders for user's positions
      const closeOrderService = getCloseOrderService();
      let allOrders: Awaited<
        ReturnType<typeof closeOrderService.findByPositionId>
      > = [];

      for (const pid of userPositionIds) {
        // Skip if filtering by positionId and this isn't it
        if (positionId && pid !== positionId) continue;

        const orders = await closeOrderService.findByPositionId(pid, {
          closeOrderType,
          status: status as
            | 'pending'
            | 'active'
            | 'triggering'
            | 'executed'
            | 'cancelled'
            | 'expired'
            | 'failed'
            | undefined,
        });
        allOrders = allOrders.concat(orders);
      }

      // Serialize orders
      const serializedOrders = allOrders.map(serializeCloseOrder);

      // Build response
      const response = createSuccessResponse(serializedOrders);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/close-orders',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve close orders'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
