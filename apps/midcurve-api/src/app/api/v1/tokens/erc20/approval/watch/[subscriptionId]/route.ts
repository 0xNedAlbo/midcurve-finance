/**
 * ERC-20 Token Approval Subscription Poll Endpoint
 *
 * GET /api/v1/tokens/erc20/approval/watch/[subscriptionId] - Poll subscription status
 * DELETE /api/v1/tokens/erc20/approval/watch/[subscriptionId] - Cancel subscription
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint checks the current approval state for a subscription.
 * The GET endpoint also serves as a heartbeat to keep the subscription active.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  type Erc20ApprovalSubscriptionPollResponseData,
  type Erc20ApprovalSubscriptionCancelResponseData,
} from '@midcurve/api-shared';
import {
  type Erc20ApprovalSubscriptionConfig,
  type Erc20ApprovalSubscriptionState,
  isUnlimitedApproval,
  hasApproval,
} from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@midcurve/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/approval/watch/[subscriptionId]
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/tokens/erc20/approval/watch/[subscriptionId]
 *
 * Poll for subscription status. Also serves as heartbeat to keep subscription active.
 *
 * If subscription is paused, it will be reactivated.
 *
 * Returns:
 * - 200 OK - Current subscription state
 * - 404 Not Found - Subscription not found or deleted
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ subscriptionId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      const { subscriptionId } = await context.params;

      // 1. Look up the subscription from database
      const subscription = await prisma.onchainDataSubscribers.findUnique({
        where: { subscriptionId },
      });

      if (!subscription) {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.NOT_FOUND, 'Subscription not found'),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
        );
      }

      // 2. Check if deleted
      if (subscription.status === 'deleted') {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.NOT_FOUND, 'Subscription has been deleted'),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
        );
      }

      const now = new Date();
      const config = subscription.config as unknown as Erc20ApprovalSubscriptionConfig;
      const state = subscription.state as unknown as Erc20ApprovalSubscriptionState;

      // 3. If paused, reactivate
      let status = subscription.status as 'active' | 'paused';
      if (subscription.status === 'paused') {
        await prisma.onchainDataSubscribers.update({
          where: { id: subscription.id },
          data: {
            status: 'active',
            pausedAt: null,
            lastPolledAt: now,
          },
        });
        status = 'active';

        apiLogger.info({ subscriptionId, msg: 'Subscription reactivated via poll' });
      } else {
        // Update lastPolledAt (heartbeat)
        await prisma.onchainDataSubscribers.update({
          where: { id: subscription.id },
          data: { lastPolledAt: now },
        });
      }

      // 4. Build response
      const currentAllowance = state.approvalAmount;
      const pollUrl = `/api/v1/tokens/erc20/approval/watch/${subscriptionId}`;

      const responseData: Erc20ApprovalSubscriptionPollResponseData = {
        subscriptionId,
        status,
        tokenAddress: config.tokenAddress,
        ownerAddress: config.walletAddress,
        spenderAddress: config.spenderAddress,
        chainId: config.chainId,
        currentAllowance,
        isUnlimited: isUnlimitedApproval(currentAllowance),
        hasApproval: hasApproval(currentAllowance),
        pollUrl,
        createdAt: subscription.createdAt.toISOString(),
        lastPolledAt: now.toISOString(),
        lastUpdatedAt: state.lastUpdatedAt,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/tokens/erc20/approval/watch/[subscriptionId]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * DELETE /api/v1/tokens/erc20/approval/watch/[subscriptionId]
 *
 * Cancel/delete a subscription.
 *
 * The subscription is marked as 'deleted' and will be cleaned up by the worker.
 *
 * Returns:
 * - 200 OK - Subscription marked for deletion
 * - 404 Not Found - Subscription not found
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ subscriptionId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      const { subscriptionId } = await context.params;

      // Look up the subscription
      const subscription = await prisma.onchainDataSubscribers.findUnique({
        where: { subscriptionId },
      });

      if (!subscription) {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.NOT_FOUND, 'Subscription not found'),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
        );
      }

      if (subscription.status === 'deleted') {
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(ApiErrorCode.NOT_FOUND, 'Subscription already deleted'),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND] }
        );
      }

      // Mark as deleted (worker will clean up)
      await prisma.onchainDataSubscribers.update({
        where: { id: subscription.id },
        data: { status: 'deleted' },
      });

      const responseData: Erc20ApprovalSubscriptionCancelResponseData = {
        subscriptionId,
        status: 'deleted',
        message: 'Subscription deleted successfully',
      };

      const response = createSuccessResponse(responseData);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/tokens/erc20/approval/watch/[subscriptionId]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
