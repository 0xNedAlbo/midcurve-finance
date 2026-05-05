/**
 * Staking Vault Position APR Endpoint
 *
 * GET /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress/apr
 *
 * APR periods are bracketed by `STAKING_DISPOSE` events (vs `COLLECT` for NFT) —
 * the staking ledger service persists them via `UniswapV3StakingAprService` on
 * every `recalculateAggregates` pass.
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
} from '@midcurve/api-shared';
import type {
    AprPeriodsResponse,
    AprPeriodData,
    AprSummaryData,
} from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
    getUniswapV3StakingPositionService,
    getUniswapV3StakingAprService,
} from '@/lib/services';

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
            const validation = GetUniswapV3StakingPositionParamsSchema.safeParse(resolvedParams);

            if (!validation.success) {
                apiLog.validationError(apiLogger, requestId, validation.error.errors);
                const errorResponse = createErrorResponse(
                    ApiErrorCode.VALIDATION_ERROR,
                    'Invalid path parameters',
                    validation.error.errors,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
                });
            }

            const { chainId, vaultAddress } = validation.data;
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

            const aprService = getUniswapV3StakingAprService(dbPosition.id);
            const aprPeriods = await aprService.fetchAprPeriods();
            const aprSummary = await getUniswapV3StakingPositionService().fetchAprSummary(
                dbPosition.id,
            );

            const serializedPeriods = serializeBigInt(aprPeriods) as unknown as AprPeriodData[];
            const serializedSummary = serializeBigInt(aprSummary) as unknown as AprSummaryData;

            const response: AprPeriodsResponse = {
                ...createSuccessResponse(serializedPeriods),
                summary: serializedSummary,
                meta: {
                    timestamp: new Date().toISOString(),
                    count: aprPeriods.length,
                    requestId,
                },
            };

            apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
            return NextResponse.json(response, { status: 200 });
        } catch (error) {
            apiLog.methodError(
                apiLogger,
                'GET /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress/apr',
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
                'Failed to fetch staking-vault position APR',
                error instanceof Error ? error.message : String(error),
            );
            apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
            });
        }
    });
}
