/**
 * ERC-20 Token Approval Watch Endpoint
 *
 * POST /api/v1/tokens/erc20/approval/watch - Create approval subscriptions
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint creates database-backed subscriptions for watching
 * ERC-20 token approval state changes. The midcurve-onchain-data worker
 * subscribes to Approval events via WebSocket and updates the state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  Erc20ApprovalWatchBatchRequestSchema,
  type Erc20ApprovalWatchBatchResponseData,
  type Erc20ApprovalSubscriptionInfo,
} from '@midcurve/api-shared';
import {
  type Erc20ApprovalSubscriptionConfig,
  emptyErc20ApprovalState,
  isUnlimitedApproval,
  hasApproval,
} from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getErc20ApprovalService } from '@/lib/services';
import { prisma, Prisma } from '@midcurve/database';
import { getAddress } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/approval/watch
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/tokens/erc20/approval/watch
 *
 * Create subscriptions for watching token approval state changes.
 *
 * Request body:
 * - tokens: Array of { tokenAddress, chainId } to watch
 * - ownerAddress: Token owner address (same for all tokens)
 * - spenderAddress: Spender address (same for all tokens)
 *
 * Returns:
 * - 202 Accepted: Subscriptions created, includes current approval state
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate request body
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

      const validation = Erc20ApprovalWatchBatchRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { tokens, ownerAddress, spenderAddress } = validation.data;

      // Normalize addresses
      const normalizedOwner = getAddress(ownerAddress);
      const normalizedSpender = getAddress(spenderAddress);

      // 2. Process each token
      const subscriptions: Erc20ApprovalSubscriptionInfo[] = [];
      const approvalService = getErc20ApprovalService();

      for (const token of tokens) {
        const { tokenAddress, chainId } = token;
        const normalizedToken = getAddress(tokenAddress);

        // Fetch current approval from chain
        let currentAllowance: bigint;
        try {
          const approval = await approvalService.getAllowance(
            normalizedToken,
            normalizedOwner,
            normalizedSpender,
            chainId
          );
          currentAllowance = approval.allowance;
        } catch (error) {
          // If we can't fetch, default to 0
          apiLog.methodError(
            apiLogger,
            'POST /api/v1/tokens/erc20/approval/watch - getAllowance',
            error,
            { tokenAddress: normalizedToken, chainId, requestId }
          );
          currentAllowance = 0n;
        }

        // Create new subscription (1 per polling process)
        const subscriptionId = `ui:erc20-approval:${nanoid()}`;
        const createdAt = new Date();

        const config: Erc20ApprovalSubscriptionConfig = {
          chainId,
          tokenAddress: normalizedToken,
          walletAddress: normalizedOwner,
          spenderAddress: normalizedSpender,
          startedAt: createdAt.toISOString(),
        };

        await prisma.onchainDataSubscribers.create({
          data: {
            subscriptionType: 'erc20-approval',
            subscriptionId,
            status: 'active',
            expiresAfterMs: 60_000,
            lastPolledAt: createdAt,
            config: config as unknown as Prisma.InputJsonValue,
            state: {
              ...emptyErc20ApprovalState(),
              approvalAmount: currentAllowance.toString(),
            } as unknown as Prisma.InputJsonValue,
          },
        });

        const pollUrl = `/api/v1/tokens/erc20/approval/watch/${subscriptionId}`;

        subscriptions.push({
          subscriptionId,
          pollUrl,
          tokenAddress: normalizedToken,
          chainId,
          ownerAddress: normalizedOwner,
          spenderAddress: normalizedSpender,
          currentAllowance: currentAllowance.toString(),
          isUnlimited: isUnlimitedApproval(currentAllowance),
          hasApproval: hasApproval(currentAllowance),
          status: 'active',
          createdAt: createdAt.toISOString(),
        });
      }

      // 3. Return response
      const responseData: Erc20ApprovalWatchBatchResponseData = {
        subscriptions,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, { status: 202 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/tokens/erc20/approval/watch', error, {
        requestId,
      });
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
