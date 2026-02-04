/**
 * ERC-20 Token Balance Endpoint
 *
 * GET /api/v1/tokens/erc20/balance - Fetch token balances for wallet
 *
 * Supports batch queries for multiple tokens in a single request:
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x...&tokenAddress=0xA...&tokenAddress=0xB...&chainId=1
 *
 * Authentication: Required (session cookie)
 *
 * This endpoint implements backend-first architecture:
 * - Frontend never calls RPC directly
 * - All blockchain reads happen server-side
 * - Results cached for 20 seconds (matches frontend polling interval)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetTokenBalanceQuerySchema,
  type TokenBalanceBatchData,
  type TokenBalanceItem,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUserTokenBalanceService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/balance
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x...&tokenAddress=0x...&tokenAddress=0x...&chainId=1
 *
 * Fetches ERC-20 token balances for a wallet address.
 * Supports multiple tokenAddress params for batch queries.
 *
 * Query params:
 * - walletAddress (required): Wallet address to check balance (0x...)
 * - tokenAddress (required): One or more ERC-20 token contract addresses (0x...)
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 *
 * Example (single token):
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x742d...&tokenAddress=0xC02a...&chainId=1
 *
 * Example (multiple tokens):
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x742d...&tokenAddress=0xC02a...&tokenAddress=0xdAC1...&chainId=1
 *
 * Returns:
 * - Array of balances in native token decimals (as string for BigInt compatibility)
 * - 400 if invalid addresses or validation fails
 * - 502 if all RPC calls fail
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse query params - handle multiple tokenAddress values
      const searchParams = request.nextUrl.searchParams;
      const tokenAddresses = searchParams.getAll('tokenAddress');

      const queryInput = {
        walletAddress: searchParams.get('walletAddress') || '',
        tokenAddress: tokenAddresses.length > 0 ? tokenAddresses : searchParams.get('tokenAddress') || '',
        chainId: searchParams.get('chainId') || '',
      };

      const queryResult = GetTokenBalanceQuerySchema.safeParse(queryInput);

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

      const { walletAddress, tokenAddress: tokenAddressArray, chainId } = queryResult.data;

      // 2. Fetch balances for all tokens in parallel
      const balancePromises = tokenAddressArray.map(async (tokenAddr): Promise<TokenBalanceItem> => {
        try {
          const balance = await getUserTokenBalanceService().getBalance(
            walletAddress,
            tokenAddr,
            chainId
          );

          // Check if result was from cache by comparing timestamp
          const ageMs = Date.now() - balance.timestamp.getTime();
          const cached = ageMs < 1000;

          return {
            tokenAddress: balance.tokenAddress,
            balance: balance.balance.toString(),
            timestamp: balance.timestamp.toISOString(),
            cached,
          };
        } catch (error) {
          // Return error for this specific token, don't fail entire request
          return {
            tokenAddress: tokenAddr,
            balance: '0',
            timestamp: new Date().toISOString(),
            cached: false,
            error: error instanceof Error ? error.message : 'Failed to fetch balance',
          };
        }
      });

      const balances = await Promise.all(balancePromises);

      // 3. Check if all tokens failed
      const allFailed = balances.every((b) => b.error);
      if (allFailed && balances.length > 0) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.BAD_GATEWAY,
          'Failed to fetch token balances from blockchain',
          balances.map((b) => b.error)
        );

        apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_GATEWAY],
        });
      }

      // 4. Build response
      const responseData: TokenBalanceBatchData = {
        walletAddress,
        chainId,
        balances,
      };

      const response = createSuccessResponse(responseData, {
        walletAddress,
        chainId,
        tokenCount: balances.length,
        errorCount: balances.filter((b) => b.error).length,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      // Unhandled error
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/tokens/erc20/balance',
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
