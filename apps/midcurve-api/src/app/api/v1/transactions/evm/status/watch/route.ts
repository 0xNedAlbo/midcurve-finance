/**
 * EVM Transaction Status Watch Endpoint
 *
 * POST /api/v1/transactions/evm/status/watch - Create transaction status subscription
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint creates database-backed subscriptions for watching
 * EVM transaction status changes. The midcurve-onchain-data worker
 * polls transaction receipts via RPC and updates the state.
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
  EvmTxStatusWatchRequestSchema,
  type EvmTxStatusWatchResponseData,
  type EvmTxStatusSubscriptionInfo,
} from '@midcurve/api-shared';
import {
  type EvmTxStatusSubscriptionConfig,
  type EvmTxStatusSubscriptionState,
  emptyEvmTxStatusState,
} from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getEvmTransactionStatusService } from '@/lib/services';
import { prisma, Prisma } from '@midcurve/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/transactions/evm/status/watch
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/transactions/evm/status/watch
 *
 * Create a subscription for watching transaction status changes.
 *
 * Request body:
 * - txHash: Transaction hash to watch
 * - chainId: EVM chain ID
 * - targetConfirmations: Optional, number of confirmations before marking complete (default: 12)
 *
 * Returns:
 * - 202 Accepted: Subscription created, includes current status
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

      const validation = EvmTxStatusWatchRequestSchema.safeParse(body);
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

      const { txHash, chainId, targetConfirmations } = validation.data;
      const normalizedTxHash = txHash.toLowerCase();

      // 2. Check if there's an existing active/paused subscription for this tx
      const allSubscriptions = await prisma.onchainDataSubscribers.findMany({
        where: {
          subscriptionType: 'evm-tx-status',
          status: { in: ['active', 'paused'] },
        },
      });

      const existing = allSubscriptions.find((sub) => {
        const config = sub.config as unknown as EvmTxStatusSubscriptionConfig;
        return (
          config.chainId === chainId &&
          config.txHash.toLowerCase() === normalizedTxHash
        );
      });

      let subscriptionId: string;
      let createdAt: Date;
      let currentState: EvmTxStatusSubscriptionState;
      let subscriptionStatus: 'active' | 'paused';

      if (existing) {
        // Use existing subscription
        subscriptionId = existing.subscriptionId;
        createdAt = existing.createdAt;
        currentState = existing.state as unknown as EvmTxStatusSubscriptionState;
        subscriptionStatus = existing.status as 'active' | 'paused';

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
          subscriptionStatus = 'active';
        } else {
          // Update lastPolledAt
          await prisma.onchainDataSubscribers.update({
            where: { id: existing.id },
            data: { lastPolledAt: new Date() },
          });
        }
      } else {
        // Fetch current transaction status from chain
        let initialStatus: EvmTxStatusSubscriptionState;
        try {
          const txStatus = await getEvmTransactionStatusService().getStatus(txHash, chainId);
          initialStatus = {
            status: txStatus.status,
            blockNumber: txStatus.blockNumber != null ? Number(txStatus.blockNumber) : null,
            blockHash: txStatus.blockHash ?? null,
            confirmations: txStatus.confirmations ?? 0,
            gasUsed: txStatus.gasUsed?.toString() ?? null,
            effectiveGasPrice: txStatus.effectiveGasPrice?.toString() ?? null,
            logsCount: txStatus.logsCount ?? null,
            contractAddress: txStatus.contractAddress ?? null,
            lastCheckedAt: txStatus.timestamp.toISOString(),
            isComplete:
              txStatus.status !== 'pending' &&
              txStatus.status !== 'not_found' &&
              (txStatus.confirmations ?? 0) >= targetConfirmations,
            completedAt:
              txStatus.status !== 'pending' &&
              txStatus.status !== 'not_found' &&
              (txStatus.confirmations ?? 0) >= targetConfirmations
                ? txStatus.timestamp.toISOString()
                : null,
          };
        } catch (error) {
          // If we can't fetch, use pending state
          apiLog.methodError(
            apiLogger,
            'POST /api/v1/transactions/evm/status/watch - getStatus',
            error,
            { txHash, chainId, requestId }
          );
          initialStatus = emptyEvmTxStatusState();
        }

        // Create new subscription
        subscriptionId = nanoid();
        createdAt = new Date();
        subscriptionStatus = 'active';
        currentState = initialStatus;

        const config: EvmTxStatusSubscriptionConfig = {
          chainId,
          txHash: normalizedTxHash,
          targetConfirmations,
          startedAt: createdAt.toISOString(),
        };

        await prisma.onchainDataSubscribers.create({
          data: {
            subscriptionType: 'evm-tx-status',
            subscriptionId,
            status: 'active',
            expiresAfterMs: 60_000,
            lastPolledAt: createdAt,
            config: config as unknown as Prisma.InputJsonValue,
            state: currentState as unknown as Prisma.InputJsonValue,
          },
        });
      }

      const pollUrl = `/api/v1/transactions/evm/status/watch/${subscriptionId}`;

      const subscriptionInfo: EvmTxStatusSubscriptionInfo = {
        subscriptionId,
        pollUrl,
        txHash: normalizedTxHash,
        chainId,
        targetConfirmations,
        status: currentState.status,
        confirmations: currentState.confirmations,
        isComplete: currentState.isComplete,
        subscriptionStatus,
        createdAt: createdAt.toISOString(),
      };

      // 3. Return response
      const responseData: EvmTxStatusWatchResponseData = {
        subscription: subscriptionInfo,
      };

      const response = createSuccessResponse(responseData);
      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, { status: 202 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/transactions/evm/status/watch', error, {
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
