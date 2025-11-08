/**
 * ERC-20 Token Discovery Endpoint
 *
 * POST /api/v1/tokens/erc20 - Discover and create token
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { Erc20TokenService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { CreateErc20TokenRequestSchema } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const erc20TokenService = new Erc20TokenService();

/**
 * POST /api/v1/tokens/erc20
 *
 * Discover and create an ERC-20 token from on-chain data with CoinGecko enrichment.
 *
 * Request body:
 * {
 *   "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *   "chainId": 1
 * }
 *
 * Returns: Fully enriched token with CoinGecko data
 *
 * Notes:
 * - Token must be listed on CoinGecko
 * - Idempotent (returns existing token if already discovered)
 * - Address is normalized to EIP-55 checksum format
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate request body
      const body = await request.json();
      const validation = CreateErc20TokenRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request data',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { address, chainId } = validation.data;

      // Discover token (handles all logic: validation, on-chain read, enrichment, creation)
      const token = await erc20TokenService.discover({ address, chainId });

      apiLog.businessOperation(apiLogger, requestId, 'discovered', 'erc20-token', token.id, {
        address: address.slice(0, 10) + '...',
        chainId,
        symbol: token.symbol,
        name: token.name,
      });

      // Convert to API response format
      const response = createSuccessResponse({
        id: token.id,
        tokenType: token.tokenType,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoUrl: token.logoUrl,
        coingeckoId: token.coingeckoId,
        marketCap: token.marketCap,
        config: token.config,
        createdAt: token.createdAt.toISOString(),
        updatedAt: token.updatedAt.toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(apiLogger, 'POST /api/v1/tokens/erc20', error, { requestId });

      // Map service errors to API error codes
      if (error instanceof Error) {
        if (error.message.includes('Invalid Ethereum address')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.INVALID_ADDRESS,
            'Invalid Ethereum address format',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.INVALID_ADDRESS],
          });
        }

        if (error.message.includes('not configured')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            'Chain not supported',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
          });
        }

        if (
          error.message.includes('does not implement ERC-20') ||
          error.message.includes('Failed to read token metadata')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            'Contract does not implement ERC-20 interface',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
          });
        }

        // CoinGecko errors (token not found or API failure)
        if (error.message.includes('CoinGecko') || error.message.includes('enrichment')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.TOKEN_NOT_FOUND,
            'Token not found on CoinGecko or enrichment failed',
            error.message
          );

          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.TOKEN_NOT_FOUND],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to discover token',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
