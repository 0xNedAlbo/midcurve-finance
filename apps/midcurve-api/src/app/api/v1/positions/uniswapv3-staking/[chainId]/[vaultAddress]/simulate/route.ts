/**
 * Staking Vault Position Simulation Endpoint
 *
 * GET /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress/simulate?price=<bigint>
 *
 * Mirrors the NFT shape directly — the staking user owns 100% of the underlying
 * NFT position, so no proportional scaling step is needed (unlike Vault, which
 * scales by `sharesBalance / totalSupply`).
 *
 * Authentication: Required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
    createSuccessResponse,
    createErrorResponse,
    ApiErrorCode,
    ErrorCodeToHttpStatus,
    GetUniswapV3StakingPositionParamsSchema,
    PositionSimulateQuerySchema,
} from '@midcurve/api-shared';
import type { PositionSimulationResponse } from '@midcurve/api-shared';
import {
    calculatePositionValue,
    getTokenAmountsFromLiquidity_X96,
    priceToSqrtRatioX96,
    tickToSqrtRatioX96,
    type Erc20Token,
} from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getUniswapV3StakingPositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
    return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ chainId: string; vaultAddress: string }> },
): Promise<Response> {
    return withAuth(request, async (user, requestId) => {
        const startTime = Date.now();

        try {
            const resolvedParams = await params;
            const pathValidation = GetUniswapV3StakingPositionParamsSchema.safeParse(resolvedParams);
            if (!pathValidation.success) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.VALIDATION_ERROR,
                    'Invalid path parameters',
                    pathValidation.error.errors,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
                });
            }

            const queryValidation = PositionSimulateQuerySchema.safeParse({
                price: new URL(request.url).searchParams.get('price') ?? undefined,
            });
            if (!queryValidation.success) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.VALIDATION_ERROR,
                    'Invalid query parameters',
                    queryValidation.error.errors,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
                });
            }

            const { chainId, vaultAddress } = pathValidation.data;
            const price = BigInt(queryValidation.data.price);
            const positionHash = `uniswapv3-staking/${chainId}/${vaultAddress}`;

            const dbPosition = await getUniswapV3StakingPositionService().findByPositionHash(
                user.id, positionHash,
            );

            if (!dbPosition) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.POSITION_NOT_FOUND,
                    'Staking-vault position not found',
                    `No staking-vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`,
                );
                apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
                });
            }

            // Staking's `simulatePnLAtPrice` only returns positionValue / pnlValue /
            // pnlPercent (PnLSimulationResult), so we compute base/quote amounts
            // and phase locally — same shape as the vault route.
            const baseIsToken0 = !dbPosition.isToken0Quote;
            const baseToken = (baseIsToken0
                ? dbPosition.pool.token0
                : dbPosition.pool.token1) as Erc20Token;
            const quoteToken = (baseIsToken0
                ? dbPosition.pool.token1
                : dbPosition.pool.token0) as Erc20Token;

            const sqrtPriceJSBI = priceToSqrtRatioX96(
                baseToken.address,
                quoteToken.address,
                baseToken.decimals,
                price,
            );
            const sqrtPriceX96 = BigInt(sqrtPriceJSBI.toString());
            const sqrtPriceLowerX96 = BigInt(
                tickToSqrtRatioX96(dbPosition.tickLower).toString(),
            );
            const sqrtPriceUpperX96 = BigInt(
                tickToSqrtRatioX96(dbPosition.tickUpper).toString(),
            );

            const positionValue = calculatePositionValue(
                dbPosition.liquidity,
                sqrtPriceX96,
                dbPosition.tickLower,
                dbPosition.tickUpper,
                baseIsToken0,
            );

            const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity_X96(
                dbPosition.liquidity,
                sqrtPriceX96,
                sqrtPriceLowerX96,
                sqrtPriceUpperX96,
            );
            const baseTokenAmount = baseIsToken0 ? token0Amount : token1Amount;
            const quoteTokenAmount = baseIsToken0 ? token1Amount : token0Amount;

            const pnlValue = positionValue - dbPosition.costBasis;
            const pnlPercent =
                dbPosition.costBasis > 0n
                    ? Number((pnlValue * 1000000n) / dbPosition.costBasis) / 10000
                    : 0;

            let phase: 'below' | 'in-range' | 'above';
            if (sqrtPriceX96 < sqrtPriceLowerX96) phase = 'below';
            else if (sqrtPriceX96 >= sqrtPriceUpperX96) phase = 'above';
            else phase = 'in-range';

            const response: PositionSimulationResponse = {
                ...createSuccessResponse({
                    price: price.toString(),
                    positionValue: positionValue.toString(),
                    pnlValue: pnlValue.toString(),
                    pnlPercent,
                    baseTokenAmount: baseTokenAmount.toString(),
                    quoteTokenAmount: quoteTokenAmount.toString(),
                    phase,
                    baseTokenSymbol: baseToken.symbol,
                    quoteTokenSymbol: quoteToken.symbol,
                    baseTokenDecimals: baseToken.decimals,
                    quoteTokenDecimals: quoteToken.decimals,
                }),
                meta: { timestamp: new Date().toISOString(), requestId },
            };

            apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
            return NextResponse.json(response, { status: 200 });
        } catch (error) {
            apiLog.methodError(
                apiLogger,
                'GET /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress/simulate',
                error,
                { requestId },
            );

            if (error instanceof Error) {
                if (error.message.includes('not found') || error.message.includes('does not exist')) {
                    const errorResponse = createErrorResponse(
                        ApiErrorCode.POSITION_NOT_FOUND,
                        'Position not found',
                        error.message,
                    );
                    apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
                    return NextResponse.json(errorResponse, {
                        status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
                    });
                }
            }

            const errorResponse = createErrorResponse(
                ApiErrorCode.INTERNAL_SERVER_ERROR,
                'Failed to simulate staking-vault position',
                error instanceof Error ? error.message : String(error),
            );
            apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
            });
        }
    });
}
