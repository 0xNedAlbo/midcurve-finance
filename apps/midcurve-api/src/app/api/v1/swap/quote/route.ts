/**
 * Swap Quote Endpoint
 *
 * GET /api/v1/swap/quote - Get a swap quote from ParaSwap
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetSwapQuoteQuerySchema,
  isSwapSupportedChain,
  LOCAL_CHAIN_ID,
  type SwapQuoteData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getSwapClient } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/swap/quote
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/swap/quote
 *
 * Gets a swap quote from ParaSwap including expected output amount,
 * price impact, gas costs, and required approvals.
 *
 * Query params:
 * - chainId (required): EVM chain ID
 * - srcToken (required): Source token address
 * - srcDecimals (required): Source token decimals
 * - destToken (required): Destination token address
 * - destDecimals (required): Destination token decimals
 * - amount (required): Amount to swap in wei (as string)
 * - userAddress (required): Address that will execute the swap
 * - side (optional): SELL (default) = fixed input, BUY = fixed output
 * - slippageBps (optional): Slippage tolerance in basis points (default: 50 = 0.5%)
 *
 * Returns: Quote with destAmount, priceImpact, gasCost, minDestAmount, approvals, expiresAt
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        chainId: searchParams.get('chainId'),
        srcToken: searchParams.get('srcToken'),
        srcDecimals: searchParams.get('srcDecimals'),
        destToken: searchParams.get('destToken'),
        destDecimals: searchParams.get('destDecimals'),
        amount: searchParams.get('amount'),
        userAddress: searchParams.get('userAddress'),
        side: searchParams.get('side') || undefined,
        slippageBps: searchParams.get('slippageBps') || undefined,
      };

      // Validate query params
      const validation = GetSwapQuoteQuerySchema.safeParse(queryParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, srcToken, srcDecimals, destToken, destDecimals, amount, userAddress, side, slippageBps } =
        validation.data;

      // Check if chain is supported for swaps (ParaSwap or local mock)
      if (!isSwapSupportedChain(chainId)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CHAIN_NOT_SUPPORTED,
          `Swaps not supported for chain ${chainId}. Supported chains: 1, 42161, 8453, 10, ${LOCAL_CHAIN_ID}`
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
        });
      }

      // Get quote from swap client (ParaSwap for production, mock for local)
      // Note: chainId is validated above via isSwapSupportedChain(), safe to cast
      const client = getSwapClient(chainId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quote = await client.getQuote({
        chainId: chainId as any, // Union type doesn't accept 31337, but it's validated above
        srcToken: srcToken as `0x${string}`,
        srcDecimals,
        destToken: destToken as `0x${string}`,
        destDecimals,
        amount,
        userAddress: userAddress as `0x${string}`,
        side,
        slippageBps,
      });

      apiLogger.info({
        requestId,
        operation: 'quote',
        resourceType: 'swap',
        chainId,
        srcToken,
        destToken,
        srcAmount: quote.srcAmount,
        destAmount: quote.destAmount,
        priceImpact: quote.priceImpact,
        expiresAt: quote.expiresAt,
        msg: 'Swap quote received',
      });

      // Build response
      const quoteData: SwapQuoteData = {
        srcToken: quote.srcToken,
        destToken: quote.destToken,
        srcAmount: quote.srcAmount,
        destAmount: quote.destAmount,
        minDestAmount: quote.minDestAmount,
        priceImpact: quote.priceImpact,
        gasCostUSD: quote.gasCostUSD,
        gasCostWei: quote.gasCostWei,
        tokenTransferProxy: quote.tokenTransferProxy,
        augustusAddress: quote.augustusAddress,
        expiresAt: quote.expiresAt,
        priceRoute: quote.priceRoute,
      };

      const response = createSuccessResponse(quoteData, {
        chainId,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/swap/quote', error, { requestId });

      // Handle ParaSwap API errors
      if (error instanceof Error && error.name === 'ParaswapApiError') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.EXTERNAL_SERVICE_ERROR,
          'Failed to get swap quote from ParaSwap',
          error.message
        );

        apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.EXTERNAL_SERVICE_ERROR],
        });
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get swap quote',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
