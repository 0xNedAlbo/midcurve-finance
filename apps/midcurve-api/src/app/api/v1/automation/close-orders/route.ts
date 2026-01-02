/**
 * Automation Close Orders API Endpoints
 *
 * POST /api/v1/automation/close-orders - Register new close order
 * GET /api/v1/automation/close-orders - List user's close orders
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  RegisterCloseOrderRequestSchema,
  ListCloseOrdersQuerySchema,
  type RegisterCloseOrderResponse,
  type ListCloseOrdersResponse,
} from '@midcurve/api-shared';
import { serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getAutomationContractService,
  getCloseOrderService,
  getPoolSubscriptionService,
  getUniswapV3PositionService,
} from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import type { UniswapV3Position } from '@midcurve/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/automation/close-orders
 *
 * Register a new close order for a position.
 * Returns 202 Accepted with a poll URL for registration status.
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

      const {
        orderType,
        positionId,
        triggerMode,
        sqrtPriceX96Lower,
        sqrtPriceX96Upper,
        payoutAddress,
        validUntil,
        slippageBps,
      } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'register',
        'close-order',
        user.id,
        { orderType, positionId, triggerMode }
      );

      // Verify position exists and belongs to user
      const positionService = getUniswapV3PositionService();
      const position = await positionService.findById(positionId) as UniswapV3Position | null;

      if (!position) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Position not found: ${positionId}`
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

      // Get chain ID from position's pool
      const chainId = position.pool.config.chainId;

      // Find or ensure contract exists for this chain
      const contractService = getAutomationContractService();
      let contract = await contractService.findByUserAndChain(
        user.id,
        orderType,
        chainId
      );

      if (!contract) {
        // Create contract automatically
        contract = await contractService.create({
          userId: user.id,
          contractType: orderType,
          chainId,
        });
      }

      // Get pool address from position
      const poolAddress = position.pool.config.address;

      // Ensure pool subscription exists
      const subscriptionService = getPoolSubscriptionService();
      await subscriptionService.ensureSubscription(position.pool.id);

      // Register the close order
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.register({
        contractId: contract.id,
        orderType,
        positionId,
        nftId: BigInt(position.config.nftId),
        poolAddress,
        triggerMode,
        sqrtPriceX96Lower: sqrtPriceX96Lower ? BigInt(sqrtPriceX96Lower) : undefined,
        sqrtPriceX96Upper: sqrtPriceX96Upper ? BigInt(sqrtPriceX96Upper) : undefined,
        payoutAddress: payoutAddress ?? position.state.ownerAddress,
        operatorAddress: position.state.ownerAddress, // Will be updated when contract is deployed
        validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
        slippageBps: slippageBps ?? 100, // 1% default
      });

      // Increment pool subscription order count
      await subscriptionService.incrementOrderCount(position.pool.id);

      // Build poll URL
      const pollUrl = `/api/v1/automation/close-orders/${order.id}/status`;

      // Return 202 Accepted with polling info
      const response: RegisterCloseOrderResponse = createSuccessResponse({
        id: order.id,
        orderType: order.orderType,
        positionId: order.positionId,
        operationStatus: 'pending',
        pollUrl,
      });

      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, {
        status: 202,
        headers: { Location: pollUrl },
      });
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
 * Supports filtering by orderType, status, positionId, contractId.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        orderType: searchParams.get('orderType') ?? undefined,
        status: searchParams.get('status') ?? undefined,
        positionId: searchParams.get('positionId') ?? undefined,
        contractId: searchParams.get('contractId') ?? undefined,
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

      const { orderType, status, positionId, contractId } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'close-orders',
        user.id,
        { orderType, status, positionId, contractId }
      );

      const closeOrderService = getCloseOrderService();
      const contractService = getAutomationContractService();

      // Get user's contracts to filter orders
      const userContracts = await contractService.findByUserId(user.id);
      const userContractIds = userContracts.map((c) => c.id);

      if (userContractIds.length === 0) {
        // User has no contracts, so no orders
        const response: ListCloseOrdersResponse = createSuccessResponse([]);
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(response, { status: 200 });
      }

      // Fetch orders for all user contracts
      let allOrders: Awaited<ReturnType<typeof closeOrderService.findByContractId>> = [];

      for (const cid of userContractIds) {
        // Skip if filtering by contractId and this isn't it
        if (contractId && cid !== contractId) continue;

        const orders = await closeOrderService.findByContractId(cid, {
          orderType,
          status,
          positionId,
        });
        allOrders = allOrders.concat(orders);
      }

      // Serialize orders
      const serializedOrders = allOrders.map(serializeCloseOrder);

      // Build response
      const response: ListCloseOrdersResponse = createSuccessResponse(serializedOrders);

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
