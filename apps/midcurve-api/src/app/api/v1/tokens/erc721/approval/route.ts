/**
 * ERC-721 NFT Approval State Endpoint
 *
 * GET /api/v1/tokens/erc721/approval - Check ERC-721 NFT approval state
 *
 * Authentication: Required (session cookie)
 *
 * Supports two query modes:
 * - tokenId: Check approved address for specific NFT (getApproved)
 * - operatorAddress: Check if operator is approved for all NFTs (isApprovedForAll)
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
  Erc721ApprovalQuerySchema,
  type Erc721ApprovalData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getErc721ApprovalService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc721/approval
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/tokens/erc721/approval?tokenAddress=0x...&ownerAddress=0x...&tokenId=123&chainId=1
 * GET /api/v1/tokens/erc721/approval?tokenAddress=0x...&ownerAddress=0x...&operatorAddress=0x...&chainId=1
 *
 * Check ERC-721 NFT approval state.
 *
 * Query params:
 * - tokenAddress (required): ERC-721 contract address (0x...)
 * - ownerAddress (required): NFT owner address (0x...)
 * - tokenId (optional): Specific token ID to check approval for
 * - operatorAddress (optional): Operator address to check approval for
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 *
 * Note: Either tokenId or operatorAddress must be provided
 *
 * Returns:
 * - For tokenId query: approvedAddress (or null if none)
 * - For operatorAddress query: isApprovedForAll (boolean)
 * - hasApproval: Whether any approval exists
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query params
      const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
      const queryResult = Erc721ApprovalQuerySchema.safeParse(searchParams);

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

      const { tokenAddress, ownerAddress, tokenId, operatorAddress, chainId } = queryResult.data;

      // 2. Fetch approval from service
      let approval;
      try {
        approval = await getErc721ApprovalService().getApproval(
          tokenAddress,
          ownerAddress,
          chainId,
          { tokenId, operatorAddress }
        );
      } catch (error) {
        // Handle specific error cases
        if (error instanceof Error) {
          // Invalid addresses
          if (
            error.message.includes('Invalid token address') ||
            error.message.includes('Invalid owner address') ||
            error.message.includes('Invalid operator address')
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

          // Missing query option
          if (error.message.includes('Either tokenId or operatorAddress must be provided')) {
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
              'Failed to fetch ERC-721 approval from blockchain',
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
      const responseData: Erc721ApprovalData = {
        tokenAddress: approval.tokenAddress,
        ownerAddress: approval.ownerAddress,
        chainId: approval.chainId,
        tokenId: approval.tokenId,
        operatorAddress: approval.operatorAddress,
        approvedAddress: approval.approvedAddress,
        isApprovedForAll: approval.isApprovedForAll,
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
        'GET /api/v1/tokens/erc721/approval',
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
