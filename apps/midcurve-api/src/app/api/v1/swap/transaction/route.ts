/**
 * Swap Transaction Endpoint
 *
 * POST /api/v1/swap/transaction - Build a swap transaction from a quote
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
  BuildSwapTransactionRequestSchema,
  isParaswapSupportedChain,
  type SwapTransactionData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getParaswapClient } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/swap/transaction
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/swap/transaction
 *
 * Builds the swap transaction calldata from a previously obtained quote.
 * The quote's priceRoute must be passed in the request body.
 *
 * Request body:
 * - chainId (required): EVM chain ID
 * - srcToken (required): Source token address
 * - destToken (required): Destination token address
 * - srcAmount (required): Amount to swap in wei (as string)
 * - destAmount (required): Expected output from quote (as string)
 * - slippageBps (required): Slippage tolerance in basis points
 * - userAddress (required): Address that will execute the swap
 * - priceRoute (required): The priceRoute from the quote response
 *
 * Returns: Transaction data with to, data, value, gasLimit, minDestAmount, deadline
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse request body
      const body = await request.json();

      // Validate request body
      const validation = BuildSwapTransactionRequestSchema.safeParse(body);

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

      const { chainId, srcToken, destToken, srcAmount, destAmount, slippageBps, userAddress, priceRoute } =
        validation.data;

      // Check if chain is supported by ParaSwap
      if (!isParaswapSupportedChain(chainId)) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CHAIN_NOT_SUPPORTED,
          `ParaSwap does not support chain ${chainId}. Supported chains: 1, 42161, 8453, 10`
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
        });
      }

      // Build transaction via ParaSwap
      const client = getParaswapClient();
      const txResult = await client.buildTransaction({
        chainId,
        srcToken: srcToken as `0x${string}`,
        destToken: destToken as `0x${string}`,
        srcAmount,
        destAmount,
        priceRoute,
        userAddress: userAddress as `0x${string}`,
        slippageBps,
      });

      apiLogger.info({
        requestId,
        operation: 'build-transaction',
        resourceType: 'swap',
        chainId,
        srcToken,
        destToken,
        to: txResult.to,
        deadline: txResult.deadline,
        msg: 'Swap transaction built',
      });

      // Build response
      const txData: SwapTransactionData = {
        to: txResult.to,
        data: txResult.data,
        value: txResult.value,
        gasLimit: txResult.gasLimit,
        minDestAmount: txResult.minDestAmount,
        deadline: txResult.deadline,
      };

      const response = createSuccessResponse(txData, {
        chainId,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/swap/transaction', error, { requestId });

      // Handle ParaSwap API errors
      if (error instanceof Error && error.name === 'ParaswapApiError') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.EXTERNAL_SERVICE_ERROR,
          'Failed to build swap transaction from ParaSwap',
          error.message
        );

        apiLog.requestEnd(apiLogger, requestId, 502, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.EXTERNAL_SERVICE_ERROR],
        });
      }

      // Handle JSON parse errors
      if (error instanceof SyntaxError) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body',
          error.message
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to build swap transaction',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
