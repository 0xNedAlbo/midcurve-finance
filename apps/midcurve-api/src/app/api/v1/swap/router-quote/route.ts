/**
 * Router Swap Quote Endpoint
 *
 * GET /api/v1/swap/router-quote
 *   - Get a swap quote from the MidcurveSwapRouter service
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Address } from 'viem';
import { encodePacked, keccak256, decodeAbiParameters } from 'viem';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetRouterSwapQuoteQuerySchema,
  type RouterSwapQuoteData,
  type RouterSwapHop,
  type EncodedSwapHop,
} from '@midcurve/api-shared';
import { SharedContractNameEnum } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getSharedContractService,
  getSwapRouterService,
  getErc20TokenService,
} from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Known venue IDs for human-readable naming */
const UNISWAP_V3_VENUE_ID = keccak256(
  encodePacked(['string'], ['UniswapV3'])
);

const VENUE_NAMES: Record<string, string> = {
  [UNISWAP_V3_VENUE_ID]: 'UniswapV3',
};

/**
 * OPTIONS /api/v1/swap/router-quote
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/swap/router-quote
 *
 * Computes a swap quote using the MidcurveSwapRouter service.
 * Returns route hops, fair value pricing, deviation analysis,
 * and encoded hops for direct contract call.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (_user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        chainId: searchParams.get('chainId'),
        tokenIn: searchParams.get('tokenIn'),
        tokenInDecimals: searchParams.get('tokenInDecimals'),
        tokenOut: searchParams.get('tokenOut'),
        tokenOutDecimals: searchParams.get('tokenOutDecimals'),
        amountIn: searchParams.get('amountIn'),
        maxDeviationBps: searchParams.get('maxDeviationBps'),
        maxHops: searchParams.get('maxHops') || undefined,
      };

      // Validate
      const validation = GetRouterSwapQuoteQuerySchema.safeParse(queryParams);
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

      const {
        chainId,
        tokenIn,
        tokenInDecimals,
        tokenOut,
        tokenOutDecimals,
        amountIn,
        maxDeviationBps,
        maxHops,
      } = validation.data;

      // Look up swap router address from shared_contracts
      const sharedContractService = getSharedContractService();
      const routerContract =
        await sharedContractService.findLatestByChainAndName(
          chainId,
          SharedContractNameEnum.MIDCURVE_SWAP_ROUTER
        );

      if (!routerContract) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CHAIN_NOT_SUPPORTED,
          `MidcurveSwapRouter not deployed on chain ${chainId}`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
        });
      }

      const swapRouterAddress = routerContract.config.address as Address;

      // Compute quote
      const swapRouterService = getSwapRouterService();
      const result = await swapRouterService.computeFreeformSwapQuote({
        chainId,
        swapRouterAddress,
        tokenIn: tokenIn as Address,
        tokenInDecimals,
        tokenOut: tokenOut as Address,
        tokenOutDecimals,
        amountIn: BigInt(amountIn),
        maxDeviationBps,
        maxHops,
      });

      // Enrich hops with token symbols and venue names
      const erc20TokenService = getErc20TokenService();
      const displayHops: RouterSwapHop[] = [];
      const encodedHops: EncodedSwapHop[] = [];

      // Hops are available for both 'execute' and some 'do_not_execute' results
      const resultHops = result.kind === 'execute' ? result.hops : result.hops;
      if (resultHops && resultHops.length > 0) {
        for (const hop of resultHops) {
          // Look up token symbols
          const [tokenInData, tokenOutData] = await Promise.all([
            erc20TokenService.findByAddressAndChain(
              hop.tokenIn,
              chainId
            ),
            erc20TokenService.findByAddressAndChain(
              hop.tokenOut,
              chainId
            ),
          ]);

          // Decode fee tier from venueData
          let feeTier = 0;
          try {
            const decoded = decodeAbiParameters(
              [{ type: 'uint24' }],
              hop.venueData as `0x${string}`
            );
            feeTier = Number(decoded[0]);
          } catch {
            // If decoding fails, leave feeTier as 0
          }

          displayHops.push({
            venueId: hop.venueId,
            venueName: VENUE_NAMES[hop.venueId] ?? 'Unknown',
            tokenIn: hop.tokenIn,
            tokenInSymbol: tokenInData?.symbol ?? hop.tokenIn.slice(0, 10),
            tokenOut: hop.tokenOut,
            tokenOutSymbol: tokenOutData?.symbol ?? hop.tokenOut.slice(0, 10),
            feeTier,
          });

          encodedHops.push({
            venueId: hop.venueId,
            tokenIn: hop.tokenIn,
            tokenOut: hop.tokenOut,
            venueData: hop.venueData,
          });
        }
      }

      // Compute fair value amount out (at 0% deviation)
      const diagnostics = result.diagnostics;
      let fairValueAmountOut = '0';
      if (
        diagnostics.fairValuePrice !== null &&
        diagnostics.fairValuePrice > 0
      ) {
        // Reverse the deviation to get the raw fair value
        // absoluteFloor = fairValueOut * (10000 - maxDeviationBps) / 10000
        // => fairValueOut = absoluteFloor * 10000 / (10000 - maxDeviationBps)
        if (diagnostics.absoluteFloorAmountOut > 0n && maxDeviationBps < 10000) {
          const fv =
            (diagnostics.absoluteFloorAmountOut * 10000n) /
            BigInt(10000 - maxDeviationBps);
          fairValueAmountOut = fv.toString();
        }
      }

      // Compute actual deviation from fair value
      let actualDeviationBps: number | null = null;
      if (
        fairValueAmountOut !== '0' &&
        diagnostics.bestEstimatedAmountOut > 0n
      ) {
        const fvBig = BigInt(fairValueAmountOut);
        if (fvBig > 0n) {
          // deviation = (fairValue - estimate) / fairValue * 10000
          // Positive = estimate below fair value (negative deviation)
          actualDeviationBps = Number(
            ((fvBig - diagnostics.bestEstimatedAmountOut) * 10000n) / fvBig
          );
        }
      }

      // Build response
      const quoteData: RouterSwapQuoteData = {
        kind: result.kind,
        reason: result.kind === 'do_not_execute' ? result.reason : undefined,
        tokenIn,
        tokenOut,
        amountIn,
        estimatedAmountOut: diagnostics.bestEstimatedAmountOut.toString(),
        minAmountOut:
          result.kind === 'execute' ? result.minAmountOut.toString() : '0',
        fairValuePrice: diagnostics.fairValuePrice,
        fairValueAmountOut,
        tokenInUsdPrice: diagnostics.tokenInUsdPrice,
        tokenOutUsdPrice: diagnostics.tokenOutUsdPrice,
        maxDeviationBps,
        actualDeviationBps,
        deadline:
          result.kind === 'execute' ? result.deadline.toString() : '0',
        hops: displayHops,
        encodedHops,
        swapRouterAddress,
        diagnostics: {
          pathsEnumerated: diagnostics.pathsEnumerated,
          pathsQuoted: diagnostics.pathsQuoted,
          poolsDiscovered: diagnostics.poolsDiscovered,
        },
      };

      apiLogger.info({
        requestId,
        operation: 'router-quote',
        resourceType: 'swap',
        chainId,
        tokenIn,
        tokenOut,
        kind: result.kind,
        hopsCount: displayHops.length,
        estimatedAmountOut: diagnostics.bestEstimatedAmountOut.toString(),
        fairValuePrice: diagnostics.fairValuePrice,
        actualDeviationBps,
        msg: 'Router swap quote computed',
      });

      const response = createSuccessResponse(quoteData, {
        chainId,
        timestamp: new Date().toISOString(),
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/swap/router-quote',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to compute swap quote',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
