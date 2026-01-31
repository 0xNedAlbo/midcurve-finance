/**
 * ERC-20 Token Search by Address Endpoint
 *
 * GET /api/v1/tokens/erc20/search-by-address - Search for a token by address across multiple chains
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
  SearchTokenByAddressQuerySchema,
  type TokenSymbolResult,
} from '@midcurve/api-shared';
import { normalizeAddress } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getCoingeckoTokenService } from '@/lib/services';

// Supported chain IDs (same as CoingeckoTokenService)
const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 56, 137, 10] as const;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/tokens/erc20/search-by-address
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/tokens/erc20/search-by-address
 *
 * Search for a token by its contract address across multiple chains.
 * Returns tokens found on each chain where the address exists.
 *
 * Query params:
 * - address (required): Token contract address (0x + 40 hex chars)
 * - chainIds (optional): Comma-separated list of EVM chain IDs (defaults to all supported)
 *
 * Examples:
 * GET /api/v1/tokens/erc20/search-by-address?address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 * GET /api/v1/tokens/erc20/search-by-address?address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&chainIds=1,42161,8453
 *
 * Returns: Array of TokenSymbolResult (grouped by symbol, consistent with symbol search)
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        address: searchParams.get('address') || '',
        chainIds: searchParams.get('chainIds') || undefined,
      };

      // Validate query params
      const validation = SearchTokenByAddressQuerySchema.safeParse(queryParams);

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

      const { address, chainIds } = validation.data;

      // Normalize address
      const normalizedAddress = normalizeAddress(address);

      // Determine which chains to search
      const chainsToSearch = chainIds ?? [...SUPPORTED_CHAIN_IDS];

      // Search for token across chains
      const coingeckoService = getCoingeckoTokenService();
      const tokens = await coingeckoService.searchByAddressAcrossChains(
        normalizedAddress,
        chainsToSearch
      );

      // Group results by symbol (consistent with symbol search response format)
      const symbolMap = new Map<string, TokenSymbolResult>();

      for (const token of tokens) {
        const existing = symbolMap.get(token.symbol);

        if (existing) {
          // Same symbol found on another chain - add to addresses array
          existing.addresses.push({
            chainId: token.chainId,
            address: token.tokenAddress,
          });
          // Update market cap if this chain has a higher value
          if (
            token.marketCapUsd &&
            (!existing.marketCap || token.marketCapUsd > existing.marketCap)
          ) {
            existing.marketCap = Number(token.marketCapUsd);
          }
        } else {
          // New symbol - create entry
          symbolMap.set(token.symbol, {
            symbol: token.symbol,
            name: token.name,
            coingeckoId: token.coingeckoId,
            logoUrl: token.imageUrl ?? undefined,
            marketCap: token.marketCapUsd
              ? Number(token.marketCapUsd)
              : undefined,
            addresses: [
              {
                chainId: token.chainId,
                address: token.tokenAddress,
              },
            ],
          });
        }
      }

      // Convert map to array and sort by market cap
      const results = Array.from(symbolMap.values()).sort((a, b) => {
        if (a.marketCap && b.marketCap) return b.marketCap - a.marketCap;
        if (a.marketCap) return -1;
        if (b.marketCap) return 1;
        return 0;
      });

      apiLogger.info({
        requestId,
        operation: 'search-by-address',
        resourceType: 'erc20-tokens',
        address: normalizedAddress.slice(0, 10) + '...',
        chainsSearched: chainsToSearch.length,
        resultsCount: results.length,
        msg: `Address search returned ${results.length} unique symbols`,
      });

      const response = createSuccessResponse(results, {
        address: normalizedAddress,
        chainsSearched: chainsToSearch.length,
        chainsWithResults: tokens.length,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/tokens/erc20/search-by-address',
        error,
        { requestId }
      );

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to search tokens by address',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
