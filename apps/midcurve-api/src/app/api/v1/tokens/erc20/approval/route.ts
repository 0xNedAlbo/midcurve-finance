/**
 * ERC-20 Token Approval State Endpoint
 *
 * GET /api/v1/tokens/erc20/approval - Check ERC-20 token allowance
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint implements backend-first architecture:
 * - Frontend never calls RPC directly
 * - All blockchain reads happen server-side
 * - Results cached for 30 seconds
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  Erc20ApprovalQuerySchema,
  type Erc20ApprovalData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getErc20ApprovalService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/approval
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/tokens/erc20/approval?tokenAddress=0x...&ownerAddress=0x...&spenderAddress=0x...&chainId=1
 *
 * Check ERC-20 token allowance for an owner/spender pair.
 *
 * Query params:
 * - tokenAddress (required): ERC-20 token contract address (0x...)
 * - ownerAddress (required): Token owner address (0x...)
 * - spenderAddress (required): Spender address to check allowance for (0x...)
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 *
 * Returns:
 * - allowance: The approved amount (as string for BigInt)
 * - isUnlimited: Whether unlimited approval is set
 * - hasApproval: Whether any approval exists (allowance > 0)
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const queryResult = Erc20ApprovalQuerySchema.safeParse(searchParams);

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

      const { tokenAddress, ownerAddress, spenderAddress, chainId } = queryResult.data;

      // 2. Fetch allowance from service
      let approval;
      try {
        approval = await getErc20ApprovalService().getAllowance(
          tokenAddress,
          ownerAddress,
          spenderAddress,
          chainId
        );
      } catch (error) {
        // Handle specific error cases
        if (error instanceof Error) {
          // Invalid addresses
          if (
            error.message.includes('Invalid token address') ||
            error.message.includes('Invalid owner address') ||
            error.message.includes('Invalid spender address')
          ) {
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

          // RPC or on-chain read failure
          if (error.message.includes('Failed to fetch')) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.BAD_GATEWAY,
              'Failed to fetch ERC-20 allowance from blockchain',
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
      const responseData: Erc20ApprovalData = {
        tokenAddress: approval.tokenAddress,
        ownerAddress: approval.ownerAddress,
        spenderAddress: approval.spenderAddress,
        chainId: approval.chainId,
        allowance: approval.allowance.toString(),
        isUnlimited: approval.isUnlimited,
        hasApproval: approval.hasApproval,
        timestamp: approval.timestamp.toISOString(),
      };

      const response = createSuccessResponse(responseData);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/tokens/erc20/approval',
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
