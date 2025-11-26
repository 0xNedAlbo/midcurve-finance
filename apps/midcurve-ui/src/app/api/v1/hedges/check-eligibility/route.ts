/**
 * Hedge Eligibility Check Endpoint
 *
 * GET /api/v1/hedges/check-eligibility - Check if a position is eligible for hedging
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  CheckHedgeEligibilityQuerySchema,
  type CheckHedgeEligibilityResponse,
  type HedgeMarketResponse,
} from '@midcurve/api-shared';
import {
  RiskLayerService,
  HyperliquidHedgeResolver,
  HyperliquidClient,
  type HyperliquidResolvedMarket,
} from '@midcurve/services';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3PositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/hedges/check-eligibility
 *
 * Check if a position is eligible for hedging and return market info.
 *
 * Query params:
 * - position (required): Position hash in format protocol/chainId/nftId
 *   Example: uniswapv3/8453/5374877
 *
 * Returns:
 * - eligible: boolean - Whether position can be hedged with simple perp
 * - eligibility: 'none' | 'simplePerp' | 'advanced'
 * - riskView: Economic risk classification (riskBase, riskQuote, roles)
 * - hedgeMarket: Hyperliquid market info if eligible (null otherwise)
 * - reason: Explanation if not eligible
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse query params
      const { searchParams } = new URL(request.url);
      const queryParams = {
        position: searchParams.get('position') ?? undefined,
      };

      // Validate query params
      const validation =
        CheckHedgeEligibilityQuerySchema.safeParse(queryParams);

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

      const { position: positionHash } = validation.data;

      // Parse position coordinates from hash
      const [protocol, chainIdStr, nftIdStr] = positionHash.split('/');
      const chainId = parseInt(chainIdStr, 10);
      const nftId = parseInt(nftIdStr, 10);

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'check-eligibility',
        'hedge',
        positionHash,
        {
          protocol,
          chainId,
          nftId,
          userId: user.id,
        }
      );

      // Currently only support UniswapV3 positions
      if (protocol !== 'uniswapv3') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Unsupported protocol: ${protocol}. Only 'uniswapv3' is currently supported.`
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // Lookup position by hash
      const dbPosition = await getUniswapV3PositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!dbPosition) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          `Position not found: ${positionHash}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      // Build risk view using RiskLayerService
      const riskService = new RiskLayerService();
      const riskView = riskService.buildPositionRiskView(dbPosition);

      // Resolve hedge market if eligible for simple perp
      let hedgeMarket: HedgeMarketResponse | null = null;
      if (riskView.hedgeEligibility === 'simplePerp') {
        const hlResolver = new HyperliquidHedgeResolver();
        const resolved = hlResolver.resolve(riskView);
        if (resolved) {
          const hlData = resolved.data as HyperliquidResolvedMarket;
          hedgeMarket = {
            protocol: resolved.protocol,
            coin: hlData.coin,
            market: hlData.market,
            quote: hlData.quote,
          };

          // Fetch live market data (optional - graceful failure)
          try {
            const hlClient = new HyperliquidClient({ environment: 'mainnet' });
            const marketData = await hlClient.getMarketData(hlData.coin);

            if (marketData) {
              hedgeMarket.marketData = {
                markPx: marketData.markPx,
                fundingRate: marketData.fundingRate,
                maxLeverage: marketData.maxLeverage,
                szDecimals: marketData.szDecimals,
                onlyIsolated: marketData.onlyIsolated,
              };
            } else {
              console.error('[check-eligibility] getMarketData returned null for coin:', hlData.coin);
            }
          } catch (marketDataError) {
            // Log but don't fail the request - market data is optional enhancement
            console.error('[check-eligibility] Failed to fetch market data:', marketDataError);
            apiLogger.error(
              {
                coin: hlData.coin,
                error: marketDataError instanceof Error ? marketDataError.message : String(marketDataError),
                stack: marketDataError instanceof Error ? marketDataError.stack : undefined,
              },
              'Failed to fetch Hyperliquid market data'
            );
          }
        }
      }

      // Build response
      const response: CheckHedgeEligibilityResponse = {
        eligible: riskView.hedgeEligibility === 'simplePerp' && hedgeMarket !== null,
        eligibility: riskView.hedgeEligibility,
        riskView: {
          riskBase: riskView.riskBase,
          riskQuote: riskView.riskQuote,
          baseRole: riskView.baseRole,
          quoteRole: riskView.quoteRole,
        },
        hedgeMarket,
        reason: riskView.hedgeIneligibleReason,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(
        createSuccessResponse(response, {
          requestId,
          positionHash,
          timestamp: new Date().toISOString(),
        }),
        { status: 200 }
      );
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/hedges/check-eligibility',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to check hedge eligibility',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
