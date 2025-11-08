/**
 * ERC-20 Token Balance Endpoint
 *
 * GET /api/v1/tokens/erc20/balance - Fetch token balance for wallet
 *
 * Authentication: Optional (works for any public wallet address)
 *
 * This endpoint implements backend-first architecture:
 * - Frontend never calls RPC directly
 * - All blockchain reads happen server-side
 * - Results cached for 20 seconds (matches frontend polling interval)
 * - Replaces Wagmi's useWatchContractEvent which was causing excessive RPC calls
 */

import { NextRequest, NextResponse } from 'next/server';
import { UserTokenBalanceService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetTokenBalanceQuerySchema,
  type TokenBalanceData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Create service instance (singleton pattern via getInstance())
const balanceService = new UserTokenBalanceService();

/**
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x...&tokenAddress=0x...&chainId=1
 *
 * Fetches ERC-20 token balance for a wallet address.
 *
 * Query params:
 * - walletAddress (required): Wallet address to check balance (0x...)
 * - tokenAddress (required): ERC-20 token contract address (0x...)
 * - chainId (required): EVM chain ID (e.g., 1, 42161, 8453)
 *
 * Example:
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x742d...&tokenAddress=0xC02a...&chainId=1
 *
 * Returns:
 * - Balance in native token decimals (as string for BigInt compatibility)
 * - Timestamp when balance was fetched
 * - Whether result came from cache
 * - 400 if invalid addresses
 * - 502 if RPC call fails
 */
export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. Parse and validate query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const queryResult = GetTokenBalanceQuerySchema.safeParse(searchParams);

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

    const { walletAddress, tokenAddress, chainId } = queryResult.data;

    // 2. Fetch balance from service (cached for 20 seconds)
    let balance;
    let cached = false;
    try {
      balance = await balanceService.getBalance(walletAddress, tokenAddress, chainId);

      // Check if result was from cache by comparing timestamp
      // (If timestamp is very recent, it was likely a cache hit)
      const ageMs = Date.now() - balance.timestamp.getTime();
      cached = ageMs < 1000; // Less than 1 second old = likely from cache
    } catch (error) {
      // Handle specific error cases
      if (error instanceof Error) {
        // Invalid addresses
        if (
          error.message.includes('Invalid wallet address') ||
          error.message.includes('Invalid token address')
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
            ApiErrorCode.BAD_REQUEST,
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
          });
        }

        // RPC or on-chain read failure
        if (error.message.includes('Failed to fetch')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_GATEWAY,
            'Failed to fetch token balance from blockchain',
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
    const responseData: TokenBalanceData = {
      walletAddress: balance.walletAddress,
      tokenAddress: balance.tokenAddress,
      chainId: balance.chainId,
      balance: balance.balance.toString(), // Convert BigInt to string for JSON
      timestamp: balance.timestamp.toISOString(),
      cached,
    };

    const response = createSuccessResponse(responseData, {
      walletAddress: balance.walletAddress,
      tokenAddress: balance.tokenAddress,
      chainId,
      cached,
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
}
