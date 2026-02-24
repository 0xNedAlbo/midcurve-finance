/**
 * ERC-20 Token Balance Watch Endpoint
 *
 * POST /api/v1/tokens/erc20/balance/watch - Create balance subscriptions
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint creates database-backed subscriptions for watching
 * ERC-20 token balance changes. The midcurve-onchain-data worker
 * subscribes to Transfer events via WebSocket and updates the state.
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
  Erc20BalanceWatchBatchRequestSchema,
  type Erc20BalanceWatchBatchResponseData,
  type Erc20BalanceSubscriptionInfo,
} from '@midcurve/api-shared';
import {
  type Erc20BalanceSubscriptionConfig,
  type Erc20BalanceSubscriptionState,
  emptyErc20BalanceState,
} from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUserTokenBalanceService } from '@/lib/services';
import { isSupportedChainId, isChainWssConfigured } from '@midcurve/services';
import { prisma, Prisma } from '@midcurve/database';
import { getAddress } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/balance/watch
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/tokens/erc20/balance/watch
 *
 * Create subscriptions for watching token balance changes.
 *
 * Request body:
 * - tokens: Array of { tokenAddress, chainId } to watch
 * - walletAddress: Wallet address to watch (same for all tokens)
 *
 * Returns:
 * - 202 Accepted: Subscriptions created, includes current balance state
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

      const validation = Erc20BalanceWatchBatchRequestSchema.safeParse(body);
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

      const { tokens, walletAddress } = validation.data;

      // Normalize wallet address
      const normalizedWallet = getAddress(walletAddress);

      // 2. Process each token
      const subscriptions: Erc20BalanceSubscriptionInfo[] = [];
      const balanceService = getUserTokenBalanceService();

      for (const token of tokens) {
        const { tokenAddress, chainId } = token;

        // Validate chain is supported and has WebSocket monitoring configured
        if (!isSupportedChainId(chainId)) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            `Chain ${chainId} is not supported`
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
          });
        }

        if (!isChainWssConfigured(chainId)) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            `Chain ${chainId} does not have WebSocket monitoring configured`
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
          });
        }

        const normalizedToken = getAddress(tokenAddress);

        // Fetch all active/paused subscriptions and filter by config fields in memory
        // (JSON fields require raw queries or memory filtering in Prisma)
        const allSubscriptions = await prisma.onchainDataSubscribers.findMany({
          where: {
            subscriptionType: 'erc20-balance',
            status: { in: ['active', 'paused'] },
          },
        });

        const existing = allSubscriptions.find((sub) => {
          const config = sub.config as unknown as Erc20BalanceSubscriptionConfig;
          return (
            config.chainId === chainId &&
            config.tokenAddress.toLowerCase() === normalizedToken.toLowerCase() &&
            config.walletAddress.toLowerCase() === normalizedWallet.toLowerCase()
          );
        });

        let subscriptionId: string;
        let createdAt: Date;
        let currentBalance: bigint;
        let status: 'active' | 'paused';

        if (existing) {
          // Use existing subscription
          subscriptionId = existing.subscriptionId;
          createdAt = existing.createdAt;
          const state = existing.state as unknown as Erc20BalanceSubscriptionState;
          currentBalance = BigInt(state.balance);
          status = existing.status as 'active' | 'paused';

          // If paused, reactivate
          if (existing.status === 'paused') {
            await prisma.onchainDataSubscribers.update({
              where: { id: existing.id },
              data: {
                status: 'active',
                pausedAt: null,
                lastPolledAt: new Date(),
              },
            });
            status = 'active';
          } else {
            // Update lastPolledAt
            await prisma.onchainDataSubscribers.update({
              where: { id: existing.id },
              data: { lastPolledAt: new Date() },
            });
          }
        } else {
          // Fetch current balance from chain
          try {
            const balanceResult = await balanceService.getBalance(
              normalizedWallet,
              normalizedToken,
              chainId
            );
            currentBalance = balanceResult.balance;
          } catch (error) {
            // If we can't fetch, default to 0
            apiLog.methodError(
              apiLogger,
              'POST /api/v1/tokens/erc20/balance/watch - getBalance',
              error,
              { tokenAddress: normalizedToken, chainId, requestId }
            );
            currentBalance = 0n;
          }

          // Create new subscription
          subscriptionId = nanoid();
          createdAt = new Date();
          status = 'active';

          const config: Erc20BalanceSubscriptionConfig = {
            chainId,
            tokenAddress: normalizedToken,
            walletAddress: normalizedWallet,
            startedAt: createdAt.toISOString(),
          };

          const state: Erc20BalanceSubscriptionState = {
            ...emptyErc20BalanceState(),
            balance: currentBalance.toString(),
          };

          await prisma.onchainDataSubscribers.create({
            data: {
              subscriptionType: 'erc20-balance',
              subscriptionId,
              status: 'active',
              expiresAfterMs: 60_000,
              lastPolledAt: createdAt,
              config: config as unknown as Prisma.InputJsonValue,
              state: state as unknown as Prisma.InputJsonValue,
            },
          });
        }

        const pollUrl = `/api/v1/tokens/erc20/balance/watch/${subscriptionId}`;

        subscriptions.push({
          subscriptionId,
          pollUrl,
          tokenAddress: normalizedToken,
          chainId,
          walletAddress: normalizedWallet,
          currentBalance: currentBalance.toString(),
          status,
          createdAt: createdAt.toISOString(),
        });
      }

      // 3. Return response
      const responseData: Erc20BalanceWatchBatchResponseData = {
        subscriptions,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, { status: 202 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/tokens/erc20/balance/watch', error, {
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
