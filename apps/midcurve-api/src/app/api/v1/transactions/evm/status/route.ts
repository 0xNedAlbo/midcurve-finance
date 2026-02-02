/**
 * EVM Transaction Status Endpoint
 *
 * GET /api/v1/transactions/evm/status - Check EVM transaction status and receipt
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint implements backend-first architecture:
 * - Frontend never calls RPC directly
 * - All blockchain reads happen server-side
 * - No caching (transaction status can change rapidly)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  EvmTransactionStatusQuerySchema,
  type EvmTransactionStatusData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getEvmTransactionStatusService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/transactions/evm/status
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/transactions/evm/status?txHash=0x...&chainId=1
 *
 * Check EVM transaction status and receipt details.
 *
 * Query params:
 * - txHash (required): Transaction hash (0x-prefixed, 64 hex characters)
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 *
 * Returns:
 * - status: 'success' | 'reverted' | 'pending' | 'not_found'
 * - blockNumber: Block number where tx was included (if mined)
 * - blockHash: Block hash (if mined)
 * - gasUsed: Gas used by the transaction (if mined)
 * - confirmations: Number of block confirmations (if mined)
 * - logsCount: Number of logs emitted (if mined)
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const queryResult = EvmTransactionStatusQuerySchema.safeParse(searchParams);

      if (!queryResult.success) {
        apiLog.validationError(apiLogger, requestId, queryResult.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          queryResult.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { txHash, chainId } = queryResult.data;

      // 2. Fetch transaction status from service
      let txStatus;
      try {
        txStatus = await getEvmTransactionStatusService().getStatus(txHash, chainId);
      } catch (error) {
        // Handle specific error cases
        if (error instanceof Error) {
          // Invalid transaction hash
          if (error.message.includes('Invalid transaction hash')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.VALIDATION_ERROR,
              error.message
            );

            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
            });
          }

          // Chain not supported
          if (error.message.includes('not configured') || error.message.includes('not supported')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.CHAIN_NOT_SUPPORTED,
              error.message
            );

            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
            });
          }

          // RPC failure
          if (error.message.includes('Failed to fetch')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.BAD_GATEWAY,
              'Failed to fetch transaction status from blockchain',
              error.message
            );

            apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_GATEWAY],
            });
          }
        }

        // Unknown error
        throw error;
      }

      // 3. Build response
      const responseData: EvmTransactionStatusData = {
        txHash: txStatus.txHash,
        chainId: txStatus.chainId,
        status: txStatus.status,
        blockNumber: txStatus.blockNumber?.toString(),
        blockHash: txStatus.blockHash,
        gasUsed: txStatus.gasUsed?.toString(),
        effectiveGasPrice: txStatus.effectiveGasPrice?.toString(),
        confirmations: txStatus.confirmations,
        logsCount: txStatus.logsCount,
        contractAddress: txStatus.contractAddress,
        timestamp: txStatus.timestamp.toISOString(),
      };

      const response = createSuccessResponse(responseData);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/transactions/evm/status',
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
